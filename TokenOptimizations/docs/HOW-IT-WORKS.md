# How tokenkit works: mechanisms, theory, and implementation

> Tiếng Việt: [HOW-IT-WORKS.vi.md](HOW-IT-WORKS.vi.md)

This document is for engineers who want to know **why** tokenkit is built the way it is, **how** each mechanism works, and **where** each idea lives in the code. It is the deep companion to [GUIDE.md](GUIDE.md), which describes user-visible behavior. Read GUIDE first if you only want to use the tool.

Everything described here comes from the source in `src/` and `templates/`. Line numbers refer to the files as they are in this repository. Numbers quoted from measurements come from [COMPARE.md](COMPARE.md) and [README.md](../README.md) and were measured by the authors, not by this document.

**Contents**

1. [The cost model](#1-the-cost-model)
2. [Design principles](#2-design-principles)
3. [Architecture](#3-architecture)
4. [Hook lifecycle: the step-by-step flow](#4-hook-lifecycle-the-step-by-step-flow)
5. [Token estimation](#5-token-estimation)
6. [The output compressor](#6-the-output-compressor)
7. [Command classification and the guard](#7-command-classification-and-the-guard)
8. [Running and verifying commands](#8-running-and-verifying-commands)
9. [The repo map](#9-the-repo-map)
10. [Location hints](#10-location-hints)
11. [TaskSpec](#11-taskspec)
12. [Context budget audit](#12-context-budget-audit)
13. [Measurement](#13-measurement)
14. [Install, upgrade, and uninstall](#14-install-upgrade-and-uninstall)
15. [Health check](#15-health-check)
16. [A worked trace: "run the tests"](#16-a-worked-trace-run-the-tests)
17. [Limits, assumptions, and known quirks](#17-limits-assumptions-and-known-quirks)
18. [Code map](#18-code-map)
19. [Glossary](#19-glossary)

---

## 1. The cost model

### 1.1 One step of an agent

An agent turn is a loop. At each **step** `t` (a model call), the harness sends the whole conversation to the model and the model returns either text or a tool call. The tool runs, its result is appended, and the loop repeats. Let:

| Symbol | Meaning |
|---|---|
| `T` | number of model calls (steps) in one turn |
| `c_t` | context size in input tokens sent at step `t` |
| `a_t` | output tokens the model generates at step `t` |
| `p` | price per uncached input token |
| `p_c` | price per cached input token (about `0.1 p`, per the README) |
| `o` | price per output token (about 5–8× `p`, per the README) |

The cost of the turn is

```
cost ≈ Σ_t [ (c_t − cached part) · p  +  cached part · p_c  +  a_t · o ]
```

Almost all of `c_t` is cached from the previous step, so the input term is dominated by the cached rate. Output is expensive but short. So the practical cost is mostly **how many steps there are** times **how big the context is at each step**.

### 1.2 The lifetime cost of one token

Consider a token inserted into the context at step `k`, for example the 10,000 tokens of a test log that the agent just read. It is present in every later input `c_t` with `t > k`. Its total input cost over the turn is therefore

```
lifetime(token inserted at k) ≈ p  +  (T − k) · p_c
                              = p · (1 + 0.1 · (T − k))     using p_c ≈ 0.1 p
```

The first send is billed at the full input rate, and each later step bills it at the cached rate. This is the core of tokenkit's economics: **a large tool output costs more the earlier it arrives and the more steps follow it.**

This model is a simplification. It assumes the first send costs `p` and that every later send is a cache hit at `0.1 p`. Real cache-write premiums and cache misses vary by provider and are not documented in detail for Copilot, so treat the multiplier as an estimate.

### 1.3 Why long sessions grow quadratically

If each step adds `g` new tokens and the context starts at `c_0`, then

```
c_t = c_0 + g · t
Σ_{t=1..T} c_t = T · c_0 + g · T(T+1)/2
```

The total context processed grows with `T²`. Doubling the number of steps more than doubles the cost. Example with `c_0 = 0` and `g = 1000` tokens per step:

| Steps `T` | Σ c_t (token-steps) |
|---|---|
| 10 | 55,000 |
| 20 | 210,000 (3.8× the cost for 2× the steps) |

Two consequences drive tokenkit's design:

- **Fewer steps** matter as much as smaller outputs. This is why `tk verify` runs typecheck, lint, and tests in one call, and why the instructions say "verify once, at the end".
- **Smaller additions** matter because they are multiplied by every remaining step. This is why compression is applied to tool outputs, which are the largest additions.

### 1.4 The savings from one compression

If a tool result of `r` tokens is replaced by one of `r'` tokens at step `k`, the saving is

```
saving = (r − r') · p · (1 + 0.1 · (T − k))
```

Worked example, using the model above with 20 steps left after the result arrives (`T − k = 20`), so the multiplier is `1 + 0.1 × 20 = 3`:

- A 10,000-token test log compressed to 300 tokens.
- Saving = `(10,000 − 300) × 3 = 29,100` input-token equivalents.

The same log compressed at step `T` (the last step) saves only `(10,000 − 300) × 1`. The earlier a large output is cut, the more it is worth. This is also why tokenkit compresses the output **at the moment it is produced** (in the hook) and does not wait.

### 1.5 Where the tokens go

[COMPARE.md](COMPARE.md) measured the prompt composition of a real VS Code request at about 27k tokens. The fixed part is paid on every step, so it is multiplied by `T`:

| Part of every request | Share (measured, without tokenkit) | Can tokenkit change it? |
|---|---|---|
| Copilot system instructions | 38% | No (tokenkit adds about 324 tokens) |
| Tool definitions (schemas of every enabled tool) | 50% | Yes, via the `lean` agent, which restricts tools |
| User messages | 4% | Slightly (TaskSpec, terse replies) |
| Tool results | 8% | Yes: compression, guarded reads, bounded commands |

Roughly 24k tokens are fixed overhead on every call. That is why tokenkit treats two things separately: **reducing the fixed overhead** (instructions, tool list, skill descriptions), and **reducing the growing part** (tool results and the number of steps).

---

## 2. Design principles

These are the ideas behind the code. Each one explains a specific design choice.

### 2.1 Lossy in the context, lossless on disk

The compressor throws lines away, which is lossy. But every compressed output is also written in full to `.tokenkit/logs/` (`tool-*.log`, `run-*.log`, `last.log`), and the model is told which file to grep. So the agent can always recover the detail when it needs it. The principle is: **the context gets the minimum that supports the next decision, and the disk keeps everything.**

### 2.2 Most of a test log is low-information bulk

A typical failing test run has a few lines that change what the agent does next (the failing assertion, the expected and actual values, the file and line of the failure, the summary) and many lines that do not (passing tests, progress bars, dependency downloads, library stack frames). The compressor is a filter that approximates the question "would removing this line change the agent's next action?" It answers with rules: noise patterns, passing-test patterns, library-frame patterns, and "keep error lines and their neighbors".

### 2.3 Retrieval before reading

Reading a whole file to find one function costs its full size, every step. Grepping an index first costs a few lines and then a bounded read. tokenkit builds a grep-friendly index (the repo map) and a deterministic matcher (location hints) so the agent can **locate, then read a range**. This is a classic information-retrieval pattern: an index answers "where" cheaply, and the expensive "what" is fetched only for the answer.

### 2.4 Shrink fixed overhead

Every byte of always-on text, every tool schema, and every skill description is paid on every step. So tokenkit keeps the always-on instructions to about 324 tokens (budget 1200), keeps skill descriptions short, provides a `lean` agent with a minimal tool list, and provides a budget linter that fails CI when the always-on context grows too large.

### 2.5 Keep the prompt prefix stable

Providers cache the **prefix** of the prompt. Anything that changes early in the prompt invalidates the cache for everything after it. For that reason:

- The `sessionStart` hook injects **nothing** into the context. It refreshes a file on disk.
- The `userPromptSubmitted` hook appends hints to the user's message for that turn only.
- The budget audit warns that toggling MCP tools mid-session breaks the cache.

### 2.6 Precision over recall, deterministic and offline

Location hints are only useful if they are usually right. A wrong hint sends the agent to the wrong place and costs more than no hint. So the matcher is tuned to abstain: when nothing matches confidently, or when a vague prompt matches too many things, it prints nothing. It is also **deterministic and offline**: no model call, no embedding service, no network. The same prompt on the same repo always gives the same hint, which makes it testable (`tk locate --why`).

### 2.7 Fail open, never auto-approve

A hook that crashes must not block the agent, so every hook wraps its work and exits with code 0 (`runHook`, `hookio.mjs:88`). And the guard never grants permission. It can deny, or rewrite a command without a permission decision, so the user's normal approval flow still applies to the rewritten command.

---

## 3. Architecture

### 3.1 Three layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ Layer A: guidance (read by the model)                                 │
│   .github/copilot-instructions.md  (always-on, ~324 tokens)           │
│   .github/skills/*/SKILL.md        (name+description always-on;       │
│                                     body loaded when relevant)         │
│   .github/agents/lean.agent.md     (restricted tool list)             │
│   .github/prompts/*.prompt.md      (/q /handoff /spec /audit)         │
├──────────────────────────────────────────────────────────────────────┤
│ Layer B: enforcement (run by the harness, on events)                  │
│   .github/hooks/tokenkit.json → .tokenkit/hooks/*.mjs                 │
│     sessionStart · userPromptSubmitted · preToolUse · postToolUse     │
├──────────────────────────────────────────────────────────────────────┤
│ Layer C: the tk CLI (run by the model, by hooks, or by you)           │
│   .tokenkit/tk.mjs → lib/: compress, run, verify, repomap, locate,    │
│                             spec, budget, report, usage, doctor       │
└──────────────────────────────────────────────────────────────────────┘
```

Layer A asks the model to behave well. Layer B enforces what can be enforced automatically. Layer C is the toolbox that both A and B call. Each layer works without the others: if hooks are disabled by an organization, the instructions and the CLI still work. That is the "degrades gracefully" property the README claims.

### 3.2 Repository layout and vendoring

```
src/                       the runtime (copied into each repo's .tokenkit/)
  tk.mjs                   CLI dispatcher (argv → command)
  hooks/                   guard.mjs · post.mjs · prompt.mjs · session.mjs
  lib/                     compress · run · verify · repomap · locate · spec ·
                           rules · budget · report · usage · doctor · install ·
                           hookio · tokens · config
templates/                 files installed into a target repo (.github/…, .vscode/…)
test/                      node --test suites
docs/                      human documentation
```

`install` copies `src/` to `<repo>/.tokenkit/`. The copy is **vendored**: it is committed to the target repository, so teammates and the cloud agent get the same runtime from git, with no install step of their own. Hooks reference the vendored copy by a relative path (`./.tokenkit/hooks/guard.mjs`), so they run against the repo's own version, not the one you installed from.

The runtime finds its own location with `KIT_DIR = dirname(fileURLToPath(import.meta.url)) / ..` (`config.mjs`). This is why the same code works both in the source checkout and inside `.tokenkit/`.

### 3.3 Two payload dialects, one interface

Copilot sends hook payloads in two shapes depending on the harness:

| Field | camelCase (Copilot CLI, cloud agent, some VS Code paths) | snake_case (VS Code, Claude-style) |
|---|---|---|
| tool name | `toolName` | `tool_name` |
| arguments | `toolArgs` (object or JSON string) | `tool_input` |
| result | `toolResult: { resultType, textResultForLlm }` | `tool_response` |

`normalize()` (`hookio.mjs:19`) converts either dialect into one shape `{ camel, tool, args, argsWereString, output, cwd }`. It also parses `toolArgs` if it arrives as a JSON string. The emit helpers answer in the dialect the harness expects: `emitDeny` writes both `permissionDecision` and `hookSpecificOutput.permissionDecision`, and `emitRewrite` writes both `modifiedArgs` (CLI) and `hookSpecificOutput.updatedInput` (VS Code). Keeping the dialect knowledge in one file is a deliberate **adapter** design, so the rest of the code does not care which harness it runs in.

---

## 4. Hook lifecycle: the step-by-step flow

The hook file (`templates/.github/hooks/tokenkit.json`) registers four events. Each one runs a small Node script through `node -e "import('./.tokenkit/hooks/X.mjs').catch(()=>0)"`. That one-liner works under cmd, PowerShell, bash, and sh, and exits 0 silently if the runtime is missing (fail open).

Every hook follows the same skeleton, `runHook` (`hookio.mjs:88`):

1. Read all of stdin and parse it as JSON (`readPayload`).
2. Run the hook's logic inside `try`. Any exception goes to `.tokenkit/logs/errors.jsonl`.
3. Set `process.exitCode = 0`. It uses `exitCode` and not `exit()` because stdout may still be flushing to a pipe.

### 4.1 `sessionStart` (`hooks/session.mjs`)

1. Call `mapIsStale(root, mapFile)` (`repomap.mjs:184`).
2. If the map is stale, call `writeMap` and log the reason to `session.jsonl`.
3. Print nothing. The hook exists to keep the map fresh, not to add context.

### 4.2 `userPromptSubmitted` (`hooks/prompt.mjs`)

1. If the prompt is shorter than 8 characters, or `prompt.hints` is `off`, stop.
2. Parse the prompt as a TaskSpec (`parseSpec`). If it has a verb and at least one scope or flag, expand it and emit it as context, then stop.
3. Otherwise check map staleness and refresh it if needed. (Files often appear during a session, and the agent may have just created them.)
4. Call `locate(prompt, root, …)`. If there are no hints, log `kind: none` and stop.
5. Emit the hints as `additionalContext`. VS Code appends this text to the user's message before the agent's first step.

### 4.3 `preToolUse` (`hooks/guard.mjs`)

The guard runs before every tool call. For a **shell tool** it applies rules in a fixed order, and the first match wins:

1. Background commands (`isBackground`, or `mode` async/detached) are never touched.
2. **Unbounded** commands (`git log`, recursive listings, unbounded `docker logs`, and so on) are denied with a bounded alternative. For soft cases such as `git diff`, the hook first measures the real diff size with `git diff --shortstat` and blocks only if more than 400 lines change.
3. **Reads** (`cat`, `Get-Content`, `head`, `tail`, …) of blocked paths (lockfiles, generated files, binaries) are denied. Whole-file reads over `maxReadKB` (48 KB) are denied unless a line range is given (`head`/`tail`/`-TotalCount`).
4. **Forged wrappers**: a `tk … --b64` command whose payload does not match its comment or does not classify as a build/test command is denied.
5. **Verbose** commands (test, build, install, lint, typecheck) are rewritten to run through `tk run` (default `auto` → `rewrite`). In `deny` mode they are blocked with the exact command to re-run. The rewrite uses `emitRewrite`, which sends no permission decision, so the user still approves the rewritten command.

For a **read tool** (the harness's own file viewer), the hook denies blocked paths, and denies whole-file reads over the size limit that have no range.

### 4.4 `postToolUse` (`hooks/post.mjs`)

1. Estimate the output's tokens. Record `{tool, target, tokens}` in `tools.jsonl`. This feeds `tk report`.
2. Detect the fallback condition. If this is VS Code (`!camel`), the guard is in `rewrite` mode, the command is verbose, and the output lacks the `[tk]` header, then VS Code ignored the rewrite. Write `localRewriteIgnored` to `state.json`. The next guard call switches to `deny`.
3. Decide eligibility. Only the **CLI dialect** can replace output, and only when the tool succeeded, the output is over `post.minTokens` (1500), the tool is not a file read or an edit, and the command is not `tk` itself.
4. Compress: shell output through `compress` (with the exit code parsed from the text), anything else through `headTail` (keep 60 first and 15 last lines).
5. Accept the compression only if it keeps less than 80% of the tokens (`kept < tokens × 0.8`). Otherwise the saving is not worth the change, and the original is kept.
6. Save the full original to `tool-<timestamp>.log` and return `modifiedResult` with a `[tk] output compressed …` header.

### 4.5 Harness differences

| Capability | VS Code (Copilot Chat) | Copilot CLI / cloud agent |
|---|---|---|
| preToolUse can rewrite the command (`updatedInput` / `modifiedArgs`) | Yes | Yes |
| postToolUse can replace the output (`modifiedResult`) | **No**: it can only log or append a note | Yes |
| Hook dialect | snake_case or camelCase | camelCase |
| Prompt hints (`additionalContext`) | Yes | Ignored |

Because VS Code cannot replace output after the fact, the VS Code path depends on the **guard** to rewrite commands *before* they run. The CLI path can also compress after the fact. That difference is why the output compressor is called from two places.

---

## 5. Token estimation

`estimateTokens` (`lib/tokens.mjs:4`) gives a dependency-free estimate. It splits text into runs with one regular expression:

```
/[A-Za-z]+|\d+|\n[ \t]*|[^\sA-Za-z\d]+/g
```

Each run is priced by its first character's class:

| Run | Estimate | Reasoning |
|---|---|---|
| newline plus indentation | 1 | BPE tokenizers usually merge them into one token |
| digits, length `L` | `⌈L / 3⌉` | numbers split into short pieces |
| letters, length `L` | `⌈L / 6⌉` | a word is often one or two subword tokens |
| symbols and punctuation, length `L` | `⌈L / 2⌉` | operators and punctuation often merge into short tokens |
| spaces between runs | 0 | absorbed into the neighboring token |

So `estimate(text) = Σ_runs price(run)`. The code comment says it tracks `o200k`/`cl100k` within about ±20% on prose and code. The estimator is a **budget tool**, not a billing tool. It is used to decide whether a compression is worth it, and to report savings. It is never used to decide what the model sees, except through the thresholds above. Exact counts come only from VS Code's own logs (see [section 13](#13-measurement)).

`fmtTokens` (`tokens.mjs:17`) formats numbers for humans: `1.2k`, `15k`, `2.3M`.

---

## 6. The output compressor

`compress(raw, opts)` (`lib/compress.mjs:55`) turns a command's output into a short version that keeps what the agent needs to act. It is a pipeline of six phases.

### 6.1 Phase 1: normalize

- Strip ANSI escape sequences (colors, cursor moves).
- Convert `\r\n` to `\n`. For a line that contains a bare `\r` (a progress bar that rewrites itself), keep only the last segment, which is the final state.
- Trim trailing whitespace and drop trailing empty lines.

### 6.2 Phase 2: classify each line

Each line gets exactly one of these outcomes, checked in this order:

| Order | Test | Outcome | Counted in |
|---|---|---|---|
| 1 | `LIB_FRAME` (stack frames from `node_modules`, `node:internal`, JVM/.NET/Python site-packages, Rust std, Go runtime) | Collapsed into one marker `… N library frame line(s)` | `frames` |
| 2 | `NOISE` (progress bars, `npm warn`, `Downloading …`, `Compiling … v1.2.3`, TAP metadata, and any user regex) | Dropped | `noise` |
| 3 | `PASS` (`✓`, `PASS`, `ok 12 -`, `--- PASS:`, `test x ... ok`) **and the line does not contain `fail` or `error`** | Dropped | `passed` |
| 4 | everything else | Kept | `warnings` if it matches `WARN` |

Two details matter:

- The `PASS` rule has an exception. A line such as `✓ handles error paths` contains `error`, so it is kept. Hiding a line that might say "failed" would be a dangerous mistake.
- Python tracebacks print a code line after each `File "…"` line. When `LIB_FRAME` matches a `File` line inside a library, the next indented line (the source code of that frame) is collapsed too (`skipPyCode`).

Consecutive identical kept lines are merged with a repeat count: `line  (×8)`.

### 6.3 Phase 3: collapse repetitive runs

Adjacent non-error lines are grouped by their **shape**:

```
shape(s) = s with hex literals and digit runs replaced by "0",
           and quoted contents replaced by empty quotes
```

For example, `Copying file 17 of 200` and `Copying file 18 of 200` both have shape `Copying file 0 of 0`. A run of five or more lines with the same shape keeps its first two lines, one marker `… +N similar line(s)`, and its last line. The last line is kept because it usually shows the final state.

Error lines are **never** collapsed. Each error may point at a different file or cause, so collapsing them would destroy information.

### 6.4 Phase 4: choose what to keep

Let `rows` be the collapsed list, and `cap` the line limit:

- On **failure** (`exitCode ≠ 0`): `head = 6`, `tail = 20`, `cap = maxLines = 80`.
- On **success**: `head = 0`, `tail = successTail = 8`, `cap = 2 × successTail = 16`.

If `rows.length ≤ cap`, keep everything. Otherwise:

1. Keep the first `head` rows and the last `tail` rows.
2. For each error row, in order, add a window of `±context` rows (`context = 2`) around it. A window is added only if `keep.size + window ≤ cap`. Otherwise the error is counted as dropped (`droppedErrorLines`), and the note tells the agent to grep the log.

The order encodes an assumption: **the first errors are usually the root cause, and later ones are often cascades.** So windows are granted first-come, first-served. The selection is greedy, not optimal, but it is O(n) and predictable.

### 6.5 Phase 5: render with gap markers

The kept rows are emitted in order. Every gap is replaced by `… [N line(s) omitted]`, so the agent can see that content was removed and roughly how much. The final output can be slightly longer than `cap` because of these marker lines. They are not counted in `cap`.

### 6.6 Phase 6: report what was removed

`notes` summarizes the removal: passing-test lines hidden, noise hidden, frames collapsed, warnings still in the log, and later errors cut. The caller prints these as `[tk] …`, so the agent knows what it did not see.

### 6.7 A real example

Input: 200 `Copying file N of 200` lines, then a failing test, an assertion, a stack frame, a summary line, and 50 passing-test lines. Run with `exitCode = 1`:

```text
Copying file 0 of 200
Copying file 1 of 200
  … +197 similar line(s)
Copying file 199 of 200
FAIL test/a.test.js
AssertionError: expected 3 received 4
    at Object.<anonymous> (test/a.test.js:12:5)
Tests: 1 failed, 50 passed
```

Notes: `50 passing-test line(s) hidden`. Size: 254 lines and about 1,747 estimated tokens in; 8 lines and about 78 tokens out. The failure, its message, its location, and the summary all survive.

### 6.8 Why it is shaped this way

- **Information theory in plain terms.** The output is mostly redundant (repeats, passing lines, frames). The compressor removes redundancy by pattern, and keeps the rare, surprising lines (errors) and the structural anchors (the head and the summary tail).
- **Asymmetric caps.** Failures get a larger budget than successes, because a success needs only the summary and a failure needs the detail.
- **Error windows.** An error line without its neighbors is often meaningless (`expected 3` without the test name). The ±2-line window keeps the context an error needs.

### 6.9 Known heuristic limits

- `ERROR` matches the word `error` anywhere, so a success summary such as `0 errors` counts as an error line and is kept. This is safe (it keeps more), but it is not minimal.
- Rules are regular expressions tuned for common tools. An unusual tool with no matching rules is compressed by the generic phases only (collapse, head/tail).
- The `config.run.noise` and `config.run.errors` options let a project add its own rules.

---

## 7. Command classification and the guard

### 7.1 The classifier

`classifyCommand(cmd)` (`lib/rules.mjs:59`) returns one of these kinds. Its order matters:

| Order | Condition | Kind | Effect in the guard |
|---|---|---|---|
| 1 | command contains `tokenkit/tk.mjs` | `wrapped` or `suspicious` (via `checkWrapped`) | allowed, or denied as forged |
| 2 | not piped or redirected, and matches a `BOUNDED` rule without its `ok` pattern | `unbounded` (+ `hint`, + `soft`) | denied (soft rules measure the diff first) |
| 3 | matches `READERS` (`cat`, `type`, `Get-Content`, `head`, `tail`, …) | `read` (+ `paths`) | checked against blocked paths and size |
| 4 | piped or redirected, or matches `LONG_RUNNING` (`--watch`, `dev`, `serve`, `start`, …) | `other` | left alone |
| 5 | matches `VERBOSE` (test, build, install, lint, typecheck, …) | `verbose` | rewritten or denied |
| 6 | anything else | `other` | left alone |

`BOUNDED` (`rules.mjs:24`) holds the rules that require a limit: `git log` needs `-n N`, `--since`, or similar; `git diff`/`show` should use `--stat` or a path (soft); recursive listings are denied (`ls -R`, `dir /s`, `Get-ChildItem -Recurse` without a filter, `find .` without a bound); `docker logs` needs `--tail`; `journalctl` needs `-n`.

`VERBOSE` (`rules.mjs:7`) lists about a dozen families of tools by regular expression: JavaScript package managers, Python test and lint tools, Go, Cargo, .NET, Maven and Gradle, make and CMake, Bundler and PHP and Elixir and Swift and Dart, Docker build, and Terraform plan and init.

### 7.2 Wrappers are checked, not trusted

When the guard rewrites a command, the rewritten command contains `tk run … -- <cmd>`. A model could try to smuggle a command past review by writing its own `tk --b64 <payload>` form. So `checkWrapped` (`rules.mjs:50`) accepts a wrapper only if:

1. The base64 payload decodes to a command that classifies as `verbose`, and
2. If there is a trailing `# comment`, the comment equals the decoded payload (so the human reviewing the approval prompt sees what really runs).

Otherwise the command is `suspicious` and denied. This is an integrity check: the approval prompt must show the truth.

### 7.3 Rewriting, and why it does not approve

`wrapCommand(cmd, shell, kit)` (`rules.mjs:41`) produces:

- for a simple command (letters, digits, and `@%+=:,./ -` only): `node "<kit>/tk.mjs" run --shell <shell> -- <cmd>`, which stays readable at approval time;
- otherwise: the same with `--b64 <base64>` and the original command as a trailing `# comment`, which keeps quoting, `;`, and `&&` safe.

The `--shell` argument keeps the command's syntax: `powershell` on Windows by default, or `bash` if configured (`guard.shell`). This matters because the same string can mean different things in the two shells.

### 7.4 Blocked paths and size limits

`blockedPath` (`rules.mjs:76`) tests a path against `config.guard.blockPaths` (regular expressions covering `node_modules/`, `dist/`, lockfiles, minified and binary extensions, logs and snapshots) unless it matches `allowPaths`. The size check `sizeKB` (`guard.mjs:17`) reads the file's size with `stat`, not its content.

### 7.5 The fallback when a harness ignores rewrites

`commandMode` (`hookio.mjs:80`) resolves the mode: `auto` means `rewrite`, unless `state.json` says VS Code ignored rewrites before, in which case it is `deny`. The post hook sets that flag when it sees a verbose command run without the `[tk]` header (section 4.4). This is a self-correcting design. Denying costs one extra step, which is more expensive than a rewrite, but it is safe when rewriting does not work.

### 7.6 Known quirks

- **Piped reads are classified as reads.** The check for `READERS` runs before the pipe check, so `cat package-lock.json | grep react` is classified as a `read` with paths `["package-lock.json", "|", "grep", "react"]`, and it is denied because of the lockfile. That is harmless here but not intended. A piped read of a large non-blocked file is also denied when it exceeds `maxReadKB`, even though the output of the pipe is small.
- **Piped unbounded commands are not checked** (`git log --oneline | head` is `other`). This is intentional: the pipe bounds the output.
- The rules are regular expressions over the command text, so they can be fooled by unusual quoting. They are guardrails for common mistakes, not a security boundary.

---

## 8. Running and verifying commands

### 8.1 `tk run`

`runCommand` (`lib/run.mjs:33`) executes a command, captures its whole output, and prints the compressed version. The steps:

1. Build the command string. `joinArgs` (`run.mjs:10`) passes a single argument through unchanged, so `tk run "pytest -k 'a and b'"` works, and quotes multiple arguments.
2. Choose the shell (`spawnIn`, `run.mjs:24`): `bash -c`, `powershell.exe -Command` (or `pwsh` off Windows), or the platform default.
3. Set the environment: `CI=1` unless already set (many tools then skip interactive prompts and progress bars), `FORCE_COLOR=0`, and `NO_COLOR=1`.
4. Buffer stdout and stderr together.
5. Write the full output to `run-<timestamp>.log` and `last.log`, and rotate old run logs to `keepLogs` (10).
6. Unless `--raw`, compress the output with the exit code and print a header: `[tk] OK in 3.2s · 1540→29 lines, ~10k→~300 tokens · full log: .tokenkit/logs/last.log`, followed by the notes and the compressed text.
7. Append one JSON line to `runs.jsonl` (raw and kept tokens), for `tk report`.

Two details: `timeoutSec` defaults to 0 (no timeout), and a child that fails to start is reported as exit 127 with its error message in the log.

### 8.2 `tk verify`

`verify` (`lib/verify.mjs:52`) runs every standard check in one call, so the agent makes one tool call instead of several. `detectChecks` (`verify.mjs:23`) chooses the commands:

- **Node projects** (`package.json`): look up script names in priority order. Typecheck: `typecheck`, `type-check`, `tsc`, `check-types`, `types`. Lint: `lint`. Test: `test`, `test:unit`, `unit`. Build (only with `--build`): `build`. Scripts with `watch` in them are skipped. The package manager is taken from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock[b]`, otherwise npm).
- **Python** (`pyproject.toml`, `pytest.ini`, `setup.py`): `python -m pytest -q`.
- **Go** (`go.mod`): `go vet ./...`, `go test ./...`.
- **Rust** (`Cargo.toml`): `cargo check -q`, `cargo test -q`.
- **.NET** (`.sln`, `.csproj`, `.fsproj`): `dotnet build -v q`, `dotnet test -v q --no-build`.

Each check runs through `runCommand` with `quietOk`, so a passing check prints only its one-line header, and a failing one prints its compressed output. The exit code is 1 if any check fails. The final line is a summary: `[tk] verify: typecheck OK · lint OK · test FAILED`.

---

## 9. The repo map

The repo map (`.tokenkit/repomap.md`) is a one-line-per-file symbol index that the agent can grep. Its purpose is to replace several "list, then open, then open" steps with one `grep`.

### 9.1 Building the file list

`listFiles` (`repomap.mjs:111`) asks git for tracked and untracked-but-not-ignored files: `git ls-files --cached --others --exclude-standard`. That respects `.gitignore` for free. If the folder is not a git repository, or the answer is empty (for example, when a parent repository ignores the folder), it walks the directory tree and skips `.git`, `node_modules`, `dist`, `build`, `target`, virtual environments, caches, and other directories in `SKIP_DIRS`.

`buildMap` (`repomap.mjs:143`) then keeps files that:

- have an extension in the language table (`LANGS`, `repomap.mjs:18`): JavaScript and TypeScript family, Python, Go, C#, Java, Kotlin, Scala, Rust, PHP, Ruby;
- are not generated (`.min.js`, `.d.ts`, `.g.cs`, `_pb2.py`, `.pb.go`, and similar, `GENERATED`);
- are not in `config.map.exclude`;
- are at most `maxFileKB` (256 KB).

### 9.2 Extracting symbols

`extractSymbols(text, ext)` (`repomap.mjs:78`) is a **line scanner with regular expressions**, not a parser. For each line it tries:

1. **Top-level patterns** (`lang.top`). For JavaScript: `export function|class|const …`, `function name`, `class name`, `const name = (…) =>`, `module.exports.name =`. For Python: `class`, `def`. For Go: `func (recv) name`, `func name`, `type name`. And similarly for the other languages. The first match records `{name, line}` and sets the **class state** `inClass` if the line opens a class.
2. **Method patterns** (`lang.method`), only inside a class body (or always for C#, Java, and Kotlin, which declare methods with modifiers). A method is recorded as `.name:line`, up to `MAX_METHODS = 15` per file, and keywords such as `if`, `for`, `return` are excluded.
3. **Class-body exit.** For JavaScript and Python, a non-indented, non-empty line that is not a closing bracket ends the class (`inClass = false`). This heuristic is what keeps method detection from running into top-level code.

The output for one file is one line: `src/lib/rules.mjs | VERBOSE:7 BOUNDED:24 wrapCommand:41 …`. The name is followed by its line number, and methods carry a leading dot. The agent can grep for a name and get a file and a line.

Limits of this approach: multi-line signatures, code generated at runtime, and unusual formatting can be missed. The map is a **hint index**, and the instructions tell the agent to read the range and confirm.

### 9.3 Fitting a token budget: degradation levels

The map must stay small, because it is re-read by the agent. `buildMap` tries detail levels from richest to poorest and stops at the first that fits `maxTokens` (4000):

| Level | What is kept | Typical use |
|---|---|---|
| 0 | every symbol and method | small and medium repos |
| 1 | top-level symbols only (no methods) | larger repos |
| 2 | level 1, and test files listed by path only | repos with many tests |
| 3 | paths only | very large repos |
| 4 | directory counts (`src/lib/ (14 files)`) | huge repos; always accepted |

The loop is `for level in 0..4: text = render(level); if tokens(text) ≤ maxTokens or level = 4: return`. The header records the level (`detail level 0/4`), so the reader knows how much is missing. Degradation is a **graceful loss of resolution**: a coarser map still answers "which directory", even when it no longer answers "which line".

### 9.4 Staleness

`mapIsStale(root, mapFile)` (`repomap.mjs:184`) returns a reason string, or `null` when the map is fresh. It checks, in order, and stops at the first hit:

1. The map is missing, or cannot be read: `missing`.
2. The map is older than `maxAgeMinutes` (60): `old`.
3. The number of source files in the header differs from the number now listed: `file count changed`. (A new or deleted file changes the count.)
4. Any source file has an `mtime` newer than the map: `files changed`.

The check costs one `git ls-files` and one `stat` per source file. It reads no file contents. That is cheap for normal repositories, and it is run on every prompt (`prompt.mjs`) and every session start (`session.mjs`). A repository with tens of thousands of files would make this check noticeably slower. That is a known scaling limit.

### 9.5 Resolving `file#symbol`

`findSymbol(root, path, name)` (`repomap.mjs:209`) runs the same extractor on the file, finds the symbol, and returns its range: from its line to the line before the next symbol. For a method, the next symbol of any kind ends the range. For a top-level symbol, the range ends before the next top-level symbol, so the method bodies of a class are included. This is what lets `@src/cart.js#applyDiscount` become `lines 6-7`.

---

## 10. Location hints

The prompt hook turns a plain-language request into "start reading here". It is the most heuristic part of tokenkit, and the most carefully tuned for precision.

### 10.1 Step 1: extract cues

`extractCues(prompt)` (`locate.mjs:77`) produces four kinds of cue:

| Cue | How it is found | Example |
|---|---|---|
| `idents` | text in backticks, or identifiers that look like code (contain a lowercase-uppercase transition, `_`, or `.`, or start with a capitalized word followed by another capital, such as `MyClass`) | `` `applyDiscount` `` → `applyDiscount`; `classifyCommand` → `classifyCommand` |
| `paths` | tokens that look like file paths with a known-looking extension | `src/cart.js` |
| `words` | words of three or more letters after splitting camelCase and snake_case, lowercased, minus the stop list | `discount`, `applied` |
| `joined` | adjacent non-stop word pairs joined without a space | `discountapplied`, `repomapbuilt` |

The stop list `STOP` (`locate.mjs:10`) removes function words (`the`, `and`), request verbs (`fix`, `add`, `check`), and generic code nouns (`file`, `function`, `value`). Without it, almost every request would match almost every file.

### 10.2 Step 2: score every symbol and file

For each file in the map, `locate` computes a **file score** and a **symbol score**:

**File score** (sum of):

| Evidence | Points |
|---|---|
| the prompt names the file path (or its basename) | +10 |
| a word matches the file's basename, and the basename is not generic (`index`, `utils`, `test`, …) | +6 |
| each word matches a directory name (not generic) | +2 each |

**Symbol score** (the best of these):

| Evidence | Points |
|---|---|
| an identifier from the prompt equals the symbol name exactly | +10 |
| an identifier matches case-insensitively | +8 |
| a joined word pair matches the symbol name | +8 |
| word parts of the symbol name match prompt words: 3 per matching word, plus 2 if the number of matching words is at least the number of name parts | variable |

A symbol's total is its symbol score **plus the file score**, so a function in a file whose name matches the request ranks above the same function name in an unrelated file. A file with no symbol match but a file score of at least `minScore` (5) becomes a candidate on its own, with no range.

Word matching uses `wordsMatch(a, b)`, which compares **stems**. `stem` (`locate.mjs:42`) removes a suffix from a fixed list (`ization`, `ations`, `ator`, `ing`, `ed`, `s`, …), then drops a trailing `e`, changes `y` to `i`, and removes a doubled final consonant. So `applied` and `apply` match, `validation` and `validate` match, and `compressor` and `compress` match. It is a light stemmer, not a linguistic one. The `repo`/`report` pair is kept apart because the suffix list does not strip `ort`.

### 10.3 Step 3: choose the hints

The selection is deliberately conservative:

1. **Floor.** A candidate is kept if `score ≥ max(minScore, ⌈top / 2⌉)`. Weak candidates far below the best match are dropped.
2. **Ambiguity check.** If more than 20 candidates pass the floor and the best score is under 8, the prompt is considered vague. The result is no hints at all. The comment in the code says it directly: many weak, equal matches would mislead more than help.
3. **Diversity.** At most two symbols per file, no duplicate `path#symbol` keys, and at most `maxHints` (5) overall.
4. **Ties.** A method beats its class (the method is a smaller range to read), then path order decides, so results are reproducible.

The output is a short block with the evidence:

```text
[tokenkit] Likely locations for this request (repo-map match on: compress). Read these ranges first; search only if they turn out wrong:
- src/lib/compress.mjs:55-172  compress
```

### 10.4 Worked examples (run against this repository)

These come from `tk locate --why` on this repository.

| Request | Cues | Result | Score arithmetic |
|---|---|---|---|
| `compress collapses repeated lines` | words: `compress`, `collapses`, `repeated` | `src/lib/compress.mjs:55-172 compress` | symbol `compress`: word match 3 + 2 (all parts matched) = 5; file basename `compress` +6; total 11 |
| `where is the repo map built and when is it refreshed` | words: `repo`, `map`, `built`, `refreshed`; joined `repomap` | `buildMap` and `mapIsStale` in `repomap.mjs` | file basename `repomap` matches joined `repomap` +6; symbol `mapIsStale`: word `map` 3; total 9 |
| `classifyCommand decides the guard action` | ident `classifyCommand`; words `guard`, `action` | `rules.mjs:59-75 classifyCommand`, then `guard.mjs` | exact ident +10; file `guard.mjs` basename word `guard` +6 |
| `the discount is applied twice` | words `discount`, `applied`, joined `discountapplied` | no hint | this repository has no discount code, so no candidate reaches the floor, and the output says `no confident match` |

The last row is the precision principle at work: the tool prefers saying nothing over guessing.

### 10.5 Why not embeddings or BM25?

The matcher is a hand-built lexical scorer over structured fields (path, basename, directory, symbol name). It is closer to a field-weighted ranking function than to a search engine:

- It has **no IDF**. Common words in the repository are not down-weighted, and the stop list and the generic-path list take over that job.
- It has **no embedding model**, so it cannot match synonyms. A request that never names the code (for example, "the total is wrong") gets no hint.
- It is **offline and reproducible**, and it has no index service to keep in sync.

The trade is deliberate. Hints are a cheap first step, and the instructions say to fall back to grep when they are wrong.

---

## 11. TaskSpec

TaskSpec is a one-line notation for the facts an agent would otherwise spend steps discovering. Its grammar, as implemented in `parseSpec` (`spec.mjs:46`):

```
spec   := [verb] token*
verb   := fix | add | ref | test | rev | explain | doc | perf      (aliases: refactor→ref, review→rev)
token  := "@" path [ ":" L1 ["-" L2] | "#" Symbol ]               scope
        | flag                                                    one of the FLAG_DEFS keys
        | word                                                    goal text
flag   := ">diff" | ">plan" | ">ans" | "+test" | "^min" | "^api" | "^nodeps" | "!run"
```

Parsing details:

- The verb is recognized only as the **first token**, case-insensitively. Otherwise the line is plain goal text.
- Quoted strings are one token (`tokenize`, `spec.mjs:40`).
- A malformed scope (`@` followed by something that does not match) and an unknown flag shape (`>xyz` that is not in `FLAG_DEFS`) are collected in `unknown` and reported, not silently dropped.
- Everything that is not a verb, scope, or flag is joined into the goal.

`expandSpec` (`spec.mjs:70`) turns the parsed form into the prompt text. The scope is resolved through `findSymbol`, so `#applyDiscount` becomes `lines 6-7`. Flags are split into **constraints** (`+`, `^`, `!`) and an **output shape** (`>`). The output shape is the one that matters most for cost, because it limits the length of the reply: `>diff` asks for one line, `>ans` for five lines, `>plan` for seven bullets.

The prompt hook applies TaskSpec only if the line has a verb **and** at least one scope or flag (`prompt.mjs`, section 4.2). A plain sentence starting with "fix" is not converted. The legend is generated from `FLAG_DEFS` and `VERBS` by `tk spec --legend`. A test (`test/cli.test.mjs:65`) fails if `templates/.github/prompts/spec.prompt.md` does not contain the current legend. The legend in `copilot-instructions.md` is not checked by that test. It is pasted in by hand, so a change to the verbs or flags needs that paste too.

---

## 12. Context budget audit

`audit(root)` (`budget.mjs:62`) measures what Copilot sends on **every** request, and what it loads only on demand:

- **Always-on:** `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/instructions/*.instructions.md` whose `applyTo` glob is effectively everything (`**`, `*`, `**/*.*`), and the name plus description of each skill (plus 8 tokens of overhead).
- **On demand:** the body of each `SKILL.md`, path-scoped instructions, agents, prompts, and chat modes.

Each text is priced with `estimateTokens`. The total is compared with `alwaysOnTokens` (1200). `tk budget --ci` exits with code 1 when the total is over budget, so it can be a CI gate.

The linter (`lint`, `budget.mjs:43`) looks for the bloat that the research in [COMPARE.md](COMPARE.md) found to matter:

- code blocks of more than 8 lines in always-on text (these belong in a skill);
- filler phrases (`please`, `make sure to`, `it is important that`, `you should`, `in order to`, …), because instructions are read literally and filler adds tokens without adding instructions;
- paragraphs longer than 400 characters;
- duplicate lines across always-on files (normalized to lowercase alphanumerics, and at least 24 characters);
- more than one always-on instruction file (the three are loaded together, so one should be a pointer);
- skill names that do not match their folder (a silent failure in Copilot), missing descriptions, and descriptions over 300 characters;
- MCP servers, which add their tool schemas to every request, and toggling them mid-session, which breaks the prompt cache.

`parseFrontmatter` (`budget.mjs:12`) is a small YAML reader for the front matter of these files. It handles single-line values and `>` and `|` block scalars, which is all the templates use.

---

## 13. Measurement

Measurement is in two layers, and the difference matters for what you can conclude.

### 13.1 Estimated savings (`tk report`)

`report` (`report.mjs:13`) reads the local JSON-lines logs in `.tokenkit/logs/` for the last N days:

| Log | Written by | Contains |
|---|---|---|
| `runs.jsonl` | `tk run` | raw and kept tokens per command |
| `tools.jsonl` | `post.mjs` | tokens of every tool output, and the kept tokens when compressed |
| `prompt.jsonl` | `prompt.mjs` | hints or TaskSpec expansions, with their size |
| `guard.jsonl` | `guard.mjs` | every deny, rewrite, or fallback, with the rule that fired |
| `errors.jsonl` | `runHook` | caught exceptions |
| `session.jsonl` | `session.mjs` | map refreshes, with the reason |

These are **estimates**: the savings are computed with `estimateTokens`, and "saved" means "would have been added to the context". They do not show what the model actually billed.

### 13.2 Exact figures (`tk usage`)

`usage.mjs` reads what VS Code itself records. It finds the folder's workspace storage by matching `workspace.json` (`findWorkspaceStorage`, `usage.mjs:28`), reads each session in `chatSessions/`, and summarizes it (`summarizeSession`, `usage.mjs:44`):

- turns, tool calls grouped by kind (terminal, browser, read, search, edit), and model calls (`toolCallRounds`);
- the largest prompt size seen (`promptTokens`), and the output tokens;
- the prompt composition at the start and the end (`promptTokenDetails`, shares of system, tool definitions, messages, and tool results);
- credits recorded on some steps.

When the user enables `github.copilot.chat.agentDebugLog.fileLogging.enabled`, VS Code also writes an **Agent Debug Log** per session. `debugLogStats` (`usage.mjs:123`) reads it for exact per-call numbers: model calls, input tokens, cached tokens, output tokens, tool calls, and hook events. It also counts tokenkit's own hook actions by looking for `updatedInput` with `tk.mjs`, `[tokenkit]` denies, and hint markers.

`formatCompare` (`usage.mjs:173`) puts two folders side by side and marks the change. Its rows are labeled `EXACT` when the debug log is available. The file format is internal to VS Code, so this reader is best-effort and can break in a future release.

### 13.3 Why two measurements

The estimator is good enough to choose between compression rules, but it does not capture the billing of cache hits, the reasoning tokens, or the steps that VS Code does not record. The exact logs capture the billing inputs, but only for sessions started after logging is on, and only for the fields VS Code writes. [COMPARE.md](COMPARE.md) documents the lesson from the authors' own runs: a fair comparison needs the same work, the same model, and several runs, because one tool-call path differs from another by far more than tokenkit saves. In one comparison, tokenkit compressed 82 command runs (about 60k → 15k tokens), yet the session recorded more credits, because the agent took more steps.

---

## 14. Install, upgrade, and uninstall

### 14.1 What install does

`install(target, {dryRun, force})` (`install.mjs:29`) performs four steps:

1. **Runtime.** Copy `src/` to `<target>/.tokenkit/`, excluding `logs/`, `repomap.md`, and an existing `config.json` (user settings are kept).
2. **Templates.** For each file under `templates/`, decide what to do (table below).
3. **`.gitignore`.** Append `.tokenkit/logs/`, `.tokenkit/repomap.md`, and `.tokenkit/handoff.md` if they are missing.
4. **Repo map.** Build the first `repomap.md`.

### 14.2 The manifest state machine

The installer must upgrade the files it wrote, but must never overwrite a file the user changed. It records a SHA-256 hash of each template it wrote, truncated to 16 hex characters, in `.tokenkit/manifest.json`. Hashes are computed after normalizing CRLF to LF, so Windows and Unix line endings compare equal. For each template path, with `cur` = the current file, `tpl` = the new template, and `m` = the manifest hash:

| Condition | Action | Log word |
|---|---|---|
| `cur` does not exist | write `tpl` and record it | `created` |
| `force` is set | overwrite and record it | `replaced` |
| `hash(cur) = hash(tpl)` | nothing to write; record it | `unchanged` |
| `m = hash(cur)` (the user has not edited the file since tokenkit wrote it) | write the new `tpl` | `updated` |
| anything else (edited locally, or not created by tokenkit) | keep the file | `skipped` |

The one exception is `.github/copilot-instructions.md`. It is **merged**, not replaced. `mergeBlock` (`install.mjs:22`) replaces only the text between `<!-- tokenkit:start -->` and `<!-- tokenkit:end -->`, or appends the block if the markers are missing. The user's own rules are never touched.

Files that an older version installed but the current version no longer ships are **retired**: removed if untouched, kept with a note if edited. Otherwise dead files would keep costing tokens.

### 14.3 Why hashes instead of timestamps

A timestamp says when a file changed, not whether the user changed it. A hash of the content tells you whether the file still matches what tokenkit wrote. That is the only reliable test for "untouched since install", and it survives `git checkout`, copying, and line-ending conversion.

### 14.4 Uninstall

`uninstall` (`install.mjs:120`) reverses the process with the same manifest. It removes a file only if its hash still matches the manifest, removes the tokenkit block from the instructions file (leaving the rest), removes the tokenkit `.gitignore` lines, and deletes `.tokenkit/`. Edited files are reported as `kept`.

---

## 15. Health check

`doctor(root)` (`lib/doctor.mjs:14`) is an end-to-end test of an installed repository. It does not only check that files exist. It **runs each hook command from `tokenkit.json`** through the platform shell, with a sample payload, in a temporary log folder so the repository's statistics stay clean:

| Check | Payload | What success means |
|---|---|---|
| guard blocks a lockfile | `read_file` on `package-lock.json` | the guard returns a `deny` decision |
| guard routes `npm test` | `run_in_terminal` with `npm test` | the guard returns `updatedInput` that runs through `tk.mjs` (or a deny in deny mode) |
| `userPromptSubmitted` runs | a prompt | exit 0 |
| `postToolUse` runs | a terminal output | exit 0 |
| `sessionStart` runs | no tool | exit 0 |

It also checks the hook file, the instructions block, the repo map, `.gitignore`, whether `.tokenkit/` would be committed, and the always-on budget.

What doctor cannot check is what only VS Code knows: Workspace Trust, the organization's hook policy, and whether "Chat: Configure Hooks" lists the file. The output says so.

---

## 16. A worked trace: "run the tests"

This traces one request in VS Code through every mechanism. The user types `run the tests`, and the project has a `test` script in `package.json`.

1. **Session start.** When the chat session begins, `session.mjs` runs `mapIsStale`. The map is fresh, so nothing happens and the hook prints nothing.

2. **Prompt submitted.** `prompt.mjs` receives `run the tests`. It is 13 characters, so it passes the 8-character minimum. `parseSpec` finds no verb, so it is not a TaskSpec. `mapIsStale` is still fresh. `locate` extracts cues. `run` and `tests` are in the stop list, so no cues remain (`no cues`), and the hook logs `kind: none` and adds nothing. The stop list does its job here: the request does not name any code.

3. **The agent plans a call.** The model, following the instructions, decides to run the tests with `node .tokenkit/tk.mjs run -- npm test`, or with plain `npm test`. Assume the second.

4. **Pre-tool hook.** `guard.mjs` normalizes the payload. It is a shell tool, so it runs the rules in order. `classifyCommand("npm test")` returns: not wrapped; not unbounded (no `BOUNDED` rule matches); not a reader; not piped; matches `VERBOSE` → `verbose`. The mode is `auto`, so `commandMode` returns `rewrite`, and `shellFor` picks `powershell` on Windows. `wrapCommand` produces `node "…/.tokenkit/tk.mjs" run --shell powershell -- npm test`, which is simple enough to be readable, so it is not base64-wrapped. `emitRewrite` returns it as `updatedInput`, and the log gets a `rewrite` entry. The approval prompt shows the rewritten command, not a plain `npm test`.

5. **Execution.** The harness runs the rewritten command. `tk.mjs` dispatches `run` to `runCommand`. It spawns `powershell.exe -NoProfile -NonInteractive -Command "npm test"` with `CI=1` and no colors, and buffers the output. Suppose 40 tests fail, and the output is 1,540 lines.

6. **Compression.** The full output is written to `run-<time>.log` and `last.log`. `compress` runs with `exitCode = 1`. The lines are normalized. Library frames are collapsed. Progress and passing-test lines are dropped and counted. Repeated lines collapse. There are many more than 80 rows, so the head (6 rows) and tail (20 rows) are kept, and error windows are added in order while they fit under 80. The result is about 29 lines.

7. **Output.** `runCommand` prints `[tk] FAILED exit 1 in 6.4s · 1540→29 lines, ~10k→~300 tokens · full log: .tokenkit/logs/last.log`, then the notes (for example, `1204 passing-test line(s) hidden`), then the compressed text. A line is appended to `runs.jsonl`.

8. **Post-tool hook.** `post.mjs` runs on the tool result. In VS Code (`!camel`), it only logs the output size to `tools.jsonl`. It also checks the fallback condition: the output starts with `[tk]`, so the rewrite worked, and nothing is written to `state.json`. The result is not replaced, because VS Code does not support that.

9. **Next step.** The agent reads the 29 lines. If it needs more, the header tells it where the full log is, and it greps that file instead of reading it whole. The next verification is one call (`tk verify`), not three.

The total effect on the agent's context is the difference between about 10k and about 300 tokens for this step, and that 300 tokens is then re-sent on every later step of the turn (section 1.4).

---

## 17. Limits, assumptions, and known quirks

**Assumptions in the cost model.** The model in section 1 assumes cache hits at about 10% of the input price, a single price for the first send, and steps that all re-send the full context. Real billing has cache-write premiums, provider-specific cache windows, reasoning tokens, and per-model rates. The shape of the conclusion (early and large outputs matter most; steps multiply everything) holds across those variations. The exact multipliers do not.

**Estimator accuracy.** The estimator is within roughly ±20% of a BPE tokenizer according to its own comment. The authors' measurements (README) and the exact VS Code figures (COMPARE) are the evidence for real savings. This document does not re-measure them.

**Parsers are regular expressions.** Symbol extraction and command classification do not parse the languages they describe. They miss unusual formatting and can over-match. The repo map is documented as a hint index for that reason.

**Preview surfaces.** VS Code hooks and their payload fields are a Preview feature. `hookio.mjs` is the one place that knows both dialects, so a change in field names is a one-file fix. The `localRewriteIgnored` fallback exists because a VS Code build could drop rewrites without warning.

**Only terminal output is compressed in VS Code.** Tasks, test-failure tools, and MCP tools bypass the terminal, and VS Code cannot replace their output after it runs. The `lean` agent and the skills steer the agent to terminal runs for that reason.

**The guard is a guardrail, not a sandbox.** Its rules are regular expressions over the command text. It reduces mistakes and waste. It is not a security control, and it does not prevent a determined command from doing anything.

**Known quirks, collected:**

- Piped reads are classified as reads (section 7.6).
- `ERROR` matches the word `error` in success summaries, so `0 errors` lines are kept (section 6.9).
- `mapIsStale` stats every source file on every prompt, which scales linearly with repository size (section 9.4).
- The location matcher has no IDF and no synonyms, so it misses requests that never name code (section 10.5).
- Tests: `node --test "test/*.test.mjs"` (the `npm test` script) runs 46 tests in the current repository, and all pass.

---

## 18. Code map

| Concern | File | Key function (line) | Notes |
|---|---|---|---|
| CLI dispatch | `src/tk.mjs` | `main` | one `switch` on the first argument |
| Token estimate | `src/lib/tokens.mjs` | `estimateTokens` (4) | section 5 |
| Output compressor | `src/lib/compress.mjs` | `compress` (55); regexes `NOISE` (9), `PASS` (25), `LIB_FRAME` (39), `ERROR` (49) | section 6 |
| Run a command | `src/lib/run.mjs` | `runCommand` (33), `spawnIn` (24), `joinArgs` (10) | section 8.1 |
| Verify | `src/lib/verify.mjs` | `detectChecks` (23), `verify` (52) | section 8.2 |
| Command rules | `src/lib/rules.mjs` | `classifyCommand` (59), `checkWrapped` (50), `wrapCommand` (41), `blockedPath` (76); `VERBOSE` (7), `BOUNDED` (24) | section 7 |
| Hook I/O adapter | `src/lib/hookio.mjs` | `normalize` (19), `emitDeny` (37), `emitRewrite` (47), `emitResult` (54), `logEvent` (58), `commandMode` (80), `runHook` (88) | section 3.3 |
| Guard hook | `src/hooks/guard.mjs` | `runHook` callback (43), `diffTooLarge` (25), `sizeKB` (17) | section 4.3 |
| Post hook | `src/hooks/post.mjs` | `runHook` callback (23), `headTail` (17) | section 4.4 |
| Prompt hook | `src/hooks/prompt.mjs` | `runHook` callback (23), `emitContext` (16) | section 4.2 |
| Session hook | `src/hooks/session.mjs` | `runHook` callback (10) | section 4.1 |
| Repo map | `src/lib/repomap.mjs` | `extractSymbols` (78), `listFiles` (111), `buildMap` (143), `mapIsStale` (184), `writeMap` (201), `findSymbol` (209); `LANGS` (18) | section 9 |
| Location hints | `src/lib/locate.mjs` | `extractCues` (77), `locate` (96), `formatHints` (172), `stem` (42); `STOP` (10), `GENERIC_PATH` (26), `SUFFIXES` (39) | section 10 |
| TaskSpec | `src/lib/spec.mjs` | `parseSpec` (46), `expandSpec` (70); `VERBS` (7), `FLAG_DEFS` (20) | section 11 |
| Budget audit | `src/lib/budget.mjs` | `audit` (62), `lint` (43), `parseFrontmatter` (12), `formatAudit` (144) | section 12 |
| Report | `src/lib/report.mjs` | `report` (13) | section 13.1 |
| VS Code usage | `src/lib/usage.mjs` | `findWorkspaceStorage` (28), `summarizeSession` (44), `debugLogStats` (123), `usageReport` (151), `formatCompare` (173) | section 13.2 |
| Install and uninstall | `src/lib/install.mjs` | `install` (29), `mergeBlock` (22), `uninstall` (120); `START`/`END` (7) | section 14 |
| Health check | `src/lib/doctor.mjs` | `doctor` (14) | section 15 |
| Configuration | `src/lib/config.mjs` | `DEFAULTS`, `loadConfig` (66), `merge` (58), `KIT_DIR` | every tunable is here |
| Hook registration | `templates/.github/hooks/tokenkit.json` | four events | the one-liner fail-open pattern |
| Agent guidance | `templates/.github/copilot-instructions.md` | the marked block | always-on, about 324 tokens |
| Skills | `templates/.github/skills/*/SKILL.md` | `lean-explore`, `lean-verify` | loaded when relevant |
| Tests | `test/*.test.mjs` | `node --test "test/*.test.mjs"` | 46 tests, all passing at time of writing |

### Configuration reference (from `config.mjs`)

| Key | Default | Used by | Effect |
|---|---|---|---|
| `run.maxLines` | 80 | `compress` | line cap on failure output |
| `run.headLines` / `tailLines` | 6 / 20 | `compress` | rows kept at start and end on failure |
| `run.successTail` | 8 | `compress` | tail kept on success (cap is twice this) |
| `run.context` | 2 | `compress` | lines kept around each error |
| `run.timeoutSec` | 0 | `runCommand` | 0 means no timeout |
| `run.keepLogs` | 10 | `runCommand` | run logs kept |
| `run.noise` / `run.errors` | `[]` | `compress` | project-specific regular expressions |
| `guard.commands` | `auto` | guard | `auto`, `rewrite`, `deny`, or `off` |
| `guard.reads` / `bounded` | `deny` | guard | `deny` or `off` |
| `guard.shell` | `auto` | guard | shell used for rewritten commands |
| `guard.maxReadKB` | 48 | guard | whole-file read limit without a range |
| `guard.blockPaths` / `allowPaths` | see `config.mjs` | `blockedPath` | blocked and exempted path patterns |
| `post.minTokens` | 1500 | post hook | output size threshold for compression (CLI) |
| `post.otherHead` / `otherTail` | 60 / 15 | post hook | head and tail for non-shell outputs |
| `prompt.hints` | `on` | prompt hook | `on` or `off` |
| `prompt.maxHints` | 5 | `locate` | hints per prompt |
| `prompt.minScore` | 5 | `locate` | floor for a hint (10 = exact name, 8 = two words, 5 = one whole-name word) |
| `map.maxTokens` | 4000 | `buildMap` | budget for the repo map |
| `map.maxAgeMinutes` | 60 | `mapIsStale` | map age limit |
| `map.maxFileKB` | 256 | `buildMap` | larger files are not indexed |
| `map.exclude` | `[]` | `buildMap` | regular expressions for files to leave out |
| `budget.alwaysOnTokens` | 1200 | `audit` | always-on budget |
| `budget.skillDescriptionChars` | 300 | `audit` | skill description limit |

---

## 19. Glossary

- **Step** (or model call): one round trip in which the harness sends the full context and the model replies with text or a tool call.
- **Turn**: one user request, which may contain many steps.
- **Context**: everything sent to the model at a step: instructions, tool definitions, the conversation, and tool results.
- **Prompt cache**: the provider's reuse of an identical prompt prefix at a lower price. Anything that changes an early part of the prompt breaks the cache for everything after it.
- **Fixed overhead**: the part of the context that is sent on every step regardless of the task (system instructions and tool definitions).
- **Lossy in context, lossless on disk**: the principle that compressed output is shown to the model, while the full output is kept in a log file.
- **Hook**: a script the harness runs at a lifecycle event. tokenkit has four.
- **Fail open**: a hook error must not block the agent, so the hook exits 0.
- **Rewrite**: changing a tool call's arguments before it runs. The approval prompt then shows the rewritten call.
- **Wrapper**: the `tk run … -- <cmd>` form that a rewritten command takes.
- **Repo map**: a one-line-per-file symbol index in `.tokenkit/repomap.md`.
- **Degradation level**: the step by which the repo map loses detail to fit its budget.
- **Cue**: a piece of a prompt used for matching (an identifier, a path, a word, or a joined word pair).
- **Stem**: the root of a word after a light suffix removal, used so that `applied` matches `apply`.
- **Hint**: a "start reading here" line added to a prompt.
- **TaskSpec**: the one-line notation for verb, scope, constraints, and output shape.
- **Manifest**: `.tokenkit/manifest.json`, the record of the hash of each file tokenkit wrote.
- **Always-on**: text that is sent with every request.
- **On demand**: text that is loaded only when the model decides it is relevant.
