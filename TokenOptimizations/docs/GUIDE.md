# tokenkit guide: how it works and how to use it

This guide is for people who did not build tokenkit and want to know what it does to their Copilot sessions: what it changes, what runs when, what it never touches, and how to use and tune it. Nothing here is a black box. Every behavior below maps to a file you can open.

**Contents**

1. [The problem tokenkit solves](#1-the-problem-tokenkit-solves)
2. [The big picture](#2-the-big-picture)
3. [Layer A: guidance (instructions, skills, agent, prompts)](#3-layer-a-guidance)
4. [Layer B: enforcement (hooks)](#4-layer-b-enforcement-hooks)
5. [Layer C: the `tk` command-line tool](#5-layer-c-the-tk-command-line-tool)
6. [Install and verify](#6-install-and-verify)
7. [Daily use](#7-daily-use)
8. [Configuration reference](#8-configuration-reference)
9. [Troubleshooting](#9-troubleshooting)
10. [Limits and evidence](#10-limits-and-evidence)
11. [Extending tokenkit and code map](#11-extending-tokenkit-and-code-map)

---

## 1. The problem tokenkit solves

**Copilot bills tokens.** Since June 1, 2026, GitHub Copilot charges AI credits (1 credit = $0.01) for every input token, cached input token and output token, at the price of the model you use ([changelog](https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/), [model prices](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)). Code completions and Next Edit Suggestions are free.

**Agent mode re-sends everything on every step.** One request in agent mode is a loop: the model reads the whole conversation, calls a tool (search, read a file, run a command), gets the result, and reads the whole conversation again. Anything added to the conversation is therefore paid for on every later step: in full the first time, then at about 10% of the input price while it sits in the prompt cache.

```text
step 1   [instructions][your request]                                        -> model -> "run npm test"
step 2   [instructions][your request][10,000-token test log]                 -> model -> "read cart.js"
step 3   [instructions][your request][10,000-token test log][cart.js]        -> model -> "edit cart.js"
step 4   [instructions][your request][10,000-token test log][cart.js][edit]  -> model -> ...
                                     ^ paid again on every step that follows
```

**Where the tokens go, and what tokenkit does about each:**

| Where tokens go | Why it costs | tokenkit's answer |
|---|---|---|
| Tool output: test and build logs, file reads, directory listings | Enters once, then rides along on every later step | Verbose commands run through a compressor (about 97% smaller in our test). Lockfile, generated and huge whole-file reads are blocked. `git log` and recursive listings must be bounded. |
| Exploration: search, list and read calls to find code | Each call is another full round-trip | Plain-language requests get "likely locations" from the repo map before the agent starts. A repo map gives file and line in one grep. TaskSpec puts the scope in your request. |
| Model output: explanations, whole-file rewrites | Output costs 5 to 8 times input | Terse-output rules, and answer-shape flags (`>diff`, `>ans`) |
| Always-on context: instructions, tool definitions | Sent with every call | About 720 tokens of instructions, checked by `tk budget`. A lean agent with a minimal tool list. |

The habits side (model choice, prompt cache, session length) is covered in [PLAYBOOK.md](PLAYBOOK.md).

---

## 2. The big picture

tokenkit has three layers that work together:

| Layer | What it is | How it acts | If it's missing |
|---|---|---|---|
| **A. Guidance** | Instructions, skills, a custom agent, prompt files | The model *chooses* to follow them | The agent wastes tokens freely |
| **B. Enforcement** | Four hooks Copilot runs around your prompt and tool calls | Deterministic code on every tool call | The agent is only *asked*, never stopped (still works, see [section 6](#if-your-organization-disables-hooks)) |
| **C. Tools** | The `tk` CLI: compressor, repo map, TaskSpec, audits | Called by the agent, the hooks, or you | Nothing to compress with |

### What gets installed into a repository

```text
your-repo/
├── .github/
│   ├── copilot-instructions.md        # your file; tokenkit adds one marked block (Layer A)
│   ├── instructions/
│   │   └── testing.instructions.md    # loaded only when test files are edited (Layer A)
│   ├── skills/                        # loaded only when relevant (Layer A)
│   │   ├── lean-explore/SKILL.md
│   │   ├── lean-verify/SKILL.md
│   │   ├── handoff/SKILL.md
│   │   └── context-audit/SKILL.md
│   ├── agents/lean.agent.md           # "lean" custom agent (Layer A)
│   ├── prompts/                       # /q  /handoff  /spec  slash commands (Layer A)
│   └── hooks/tokenkit.json            # tells Copilot to run the hooks (Layer B)
├── .tokenkit/                         # the runtime, committed with the repo
│   ├── tk.mjs                         # CLI entry point (Layer C)
│   ├── hooks/session.mjs prompt.mjs guard.mjs post.mjs   # hook programs (Layer B)
│   ├── lib/                           # compressor, repo map, rules, ... (Layer C)
│   ├── manifest.json                  # what install wrote (for safe upgrades)
│   ├── config.json                    # optional, your overrides
│   ├── repomap.md                     # generated, gitignored
│   ├── handoff.md                     # generated by /handoff, gitignored
│   └── logs/                          # full outputs and stats, gitignored
└── .vscode/settings.json              # only created if you had none
```

### One request, end to end

```text
 You: "the discount is applied wrong, and run the tests"      (plain language is fine)
   │
   ▼
 userPromptSubmitted hook ── node .tokenkit/hooks/prompt.mjs
   matches your words against the repo map and, if confident, attaches:
   "[tokenkit] Likely locations … - src/cart/discount.ts:1-4  applyDiscount"
   │
   ▼
 Copilot builds the prompt:
   copilot-instructions.md (incl. tokenkit block) + skill names/descriptions + your request + the hint
   │
   ▼
 ┌────────────────────── agent loop (repeats per step) ──────────────────────┐
 │ model decides a tool call, e.g.  run_in_terminal { command: "npm test" }  │
 │   │                                                                       │
 │   ▼                                                                       │
 │ preToolUse hook ── node .tokenkit/hooks/guard.mjs ──┐                     │
 │   │ reads the call as JSON on stdin                 │                     │
 │   │ answers on stdout: nothing | rewrite | deny     │                     │
 │   ▼                                                 │                     │
 │ rewrite: command becomes                            │ deny: the model gets │
 │   node ".../.tokenkit/tk.mjs" run --shell           │ the reason and a     │
 │   powershell -- npm test                            │ bounded alternative  │
 │   │                                                 └──────────────────────┤
 │   ▼                                                                       │
 │ you approve (as usual) ─► terminal runs tk ─► tk runs npm test,           │
 │   saves the full log to .tokenkit/logs/, prints ~30 lines                 │
 │   │                                                                       │
 │   ▼                                                                       │
 │ postToolUse hook ── node .tokenkit/hooks/post.mjs                         │
 │   logs the output size; in Copilot CLI also compresses big outputs        │
 │   │                                                                       │
 │   ▼                                                                       │
 │ small result goes into the conversation ─► next step                      │
 └───────────────────────────────────────────────────────────────────────────┘

 Once per session, before the loop: sessionStart hook ─► session.mjs refreshes
 .tokenkit/repomap.md if it is stale (adds nothing to the prompt).
```

---

## 3. Layer A: guidance

Guidance is plain Markdown that Copilot loads into the model's context. It costs tokens, so each piece is kept small and loaded only when needed.

### 3.1 The instructions block (always loaded, about 500 tokens)

`install` adds this block to `.github/copilot-instructions.md`, between `<!-- tokenkit:start -->` and `<!-- tokenkit:end -->`. Your own content outside the markers is never touched, and re-running install replaces only the block.

| Rule in the block | Why it saves tokens |
|---|---|
| Terse replies: no preamble, recap or closing summary; never paste whole files | Output tokens cost the most |
| Find, then read: grep the repo map or search, read only the needed line range, don't re-read | Every file read stays in the context for the rest of the session |
| Never open lockfiles, generated, minified or build output | These are huge and almost never useful |
| Run builds and tests as `node .tokenkit/tk.mjs run -- <cmd>`, narrowest target first | Compressed output; one test file instead of the whole suite |
| Bound exploratory commands (`git log -n 20`, `git diff --stat`, `--tail 100`) | Unbounded listings can be tens of thousands of tokens |
| If a `[tokenkit]` hook denies a call, run its suggested command verbatim | Avoids a back-and-forth after a deny |
| Plain-language requests: questions get short direct answers, changes get a reply of 3 lines or fewer; read `[tokenkit] Likely locations` first | Gives plain English the same answer shape and starting point as TaskSpec flags |
| Low-risk ambiguity: pick a sensible default and state it | A clarifying question costs a full extra round-trip |
| Do only what was asked | Unrequested refactors cost output and review time |
| TaskSpec legend (6 lines) | Lets you write one-line, fully scoped requests (see [5.5](#55-taskspec)) |

### 3.2 Skills (about 55 tokens each until used)

Copilot keeps only each skill's `name` and `description` in context. It reads the full `SKILL.md` body only when the task matches the description. That makes skills the cheap place for procedures.

| Skill | Loaded when | What it tells the agent |
|---|---|---|
| `lean-explore` | Locating code, or editing an unfamiliar area | A 3-call recipe: grep the repo map, then a specific text search, then read 60 to 150 lines. Stop once the exact lines are known. |
| `lean-verify` | Running builds, tests or linters, or fixing a failing test | Always use `tk run`, grep the log instead of reading it, one test first (per-runner table), at most 3 fix-and-rerun cycles, one command per terminal call, no task tools for builds |
| `handoff` | You say handoff, checkpoint or new chat, or the chat got long | Write a 25-line `.tokenkit/handoff.md` (goal, done, next, files with line ranges, decisions, verify command) |
| `context-audit` | You ask to reduce Copilot cost or clean up instructions | Run `tk budget` and `tk report`, then fix the biggest sources first |

### 3.3 Path-scoped instructions

`.github/instructions/testing.instructions.md` has an `applyTo` glob (`**/*.test.*`, `**/tests/**`, …). Copilot attaches it only when matching files are created or edited, so test rules cost nothing in sessions that don't touch tests. This is the pattern to copy for language- or framework-specific rules.

### 3.4 The `lean` agent

Pick **lean** in the chat's agent picker. Its frontmatter limits tools to `read`, `search`, `edit`, `execute` and `todos`. Every tool's definition is sent as input on every call, so fewer tools means a smaller prompt; dozens of tool definitions can cost 10,000 to 20,000 tokens. Its body asks for no narration, minimal edits and a final reply of at most 3 lines. To pin a cheaper model, uncomment the `model:` line in `.github/agents/lean.agent.md`.

### 3.5 Prompt files (slash commands)

| Command | What runs | Use it for |
|---|---|---|
| `/q <question>` | Ask mode, model `GPT-5 mini (copilot)`, no tools, at most 5 lines | Quick questions that need no repo access |
| `/handoff` | The handoff skill | Ending a long session cheaply; continue in a new chat with `#file:.tokenkit/handoff.md continue` |
| `/spec <taskspec>` | The lean agent, with TaskSpec rules | One-line scoped tasks ([5.5](#55-taskspec)) |

If your model picker shows a different name for the small model, edit `model:` in `.github/prompts/q.prompt.md`.

---

## 4. Layer B: enforcement (hooks)

### 4.1 How Copilot runs a hook

`.github/hooks/tokenkit.json` registers four events: `sessionStart`, `userPromptSubmitted` (VS Code: `UserPromptSubmit`), `preToolUse` and `postToolUse`. For each event Copilot starts a process, writes a JSON description of the event to its **stdin**, and reads a JSON answer from its **stdout**.

Every entry uses the same command, whatever the platform:

```text
node -e "import('./.tokenkit/hooks/guard.mjs').catch(()=>0)"
```

- **One string for all shells.** VS Code maps the file's `powershell` key to Windows and `bash` to Linux/macOS, and other harnesses may use cmd. This string was tested under cmd, PowerShell, bash and sh.
- **Fail-open.** If `.tokenkit/` is missing, `import()` fails, `.catch` swallows it, and node exits 0 with no output, which means "no opinion". This matters because Copilot CLI treats a crashing `preToolUse` hook as a deny.
- **Never crashes.** Each hook program wraps its work in `try/catch`, logs errors to `.tokenkit/logs/errors.jsonl`, and always exits 0.
- **Runs from the repo root** (`"cwd": "."`), with a timeout of 10 seconds (30 for `sessionStart`).

**Two payload dialects.** VS Code sends snake_case fields. Copilot CLI sends camelCase fields when the hook file uses camelCase event names. `src/lib/hookio.mjs` normalizes both, and answers in both at once (each harness ignores the other's fields):

| | VS Code (snake_case) | Copilot CLI (camelCase) |
|---|---|---|
| Tool name | `tool_name`, e.g. `run_in_terminal`, `read_file` | `toolName`, e.g. `bash`, `powershell`, `view` |
| Tool input | `tool_input` (object) | `toolArgs` (object or JSON string) |
| Tool result (post) | `tool_response` | `toolResult.textResultForLlm` |
| Deny | `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` | `permissionDecision: "deny"` + `permissionDecisionReason` |
| Rewrite input | `hookSpecificOutput.updatedInput` | `modifiedArgs` |
| Replace output (post) | not possible | `modifiedResult` |

### 4.2 The guard (`hooks/guard.mjs`, preToolUse)

The guard answers one question per tool call: let it through, rewrite it, or deny it with a better alternative. It never answers "allow", so your normal approval prompts always apply.

```text
tool call arrives
 ├─ is it a terminal/shell tool? (name contains bash|shell|powershell|terminal|command|exec, and has a "command")
 │    ├─ background / mode=async (servers, watchers) ............ pass through
 │    └─ classify the command (src/lib/rules.mjs):
 │         wrapped      already runs through tk ................ pass (a --b64 wrapper is checked first)
 │         suspicious   --b64 wrapper that doesn't match ....... DENY always
 │         unbounded    git log / ls -R / find . / tree ... .... DENY with a bounded alternative
 │         read         cat / type / Get-Content <file> ........ DENY if lockfile/generated or > 48 KB
 │         verbose      test / build / install / lint .......... REWRITE through tk (or deny in deny mode)
 │         other        everything else ........................ pass through
 └─ is it a file-read tool? (name starts with view|read|read_file|open_file ...)
      ├─ path matches a blocked pattern ........................ DENY
      ├─ no line range and file > 48 KB ........................ DENY with "find the symbol, read a range"
      └─ otherwise ............................................. pass through
```

**What counts as "verbose"** (rewritten). These are finite commands whose output is long and mostly noise on success:

| Ecosystem | Examples |
|---|---|
| JavaScript/TypeScript | `npm/pnpm/yarn/bun test`, `… run build/lint/typecheck`, `… install/ci/add`, `jest`, `vitest`, `mocha`, `tsc`, `eslint`, `playwright test`, `nx run/test/build` |
| Python | `pytest`, `tox`, `mypy`, `ruff check`, `pylint`, `pip install`, `poetry install`, `uv sync` |
| .NET / JVM | `dotnet test/build/restore/publish`, `msbuild`, `mvn`, `gradle`, `./gradlew` |
| Go / Rust / native | `go test/build/vet`, `cargo test/build/check/clippy`, `make`, `cmake --build`, `ctest`, `bazel build/test` |
| Others | `rspec`, `phpunit`, `composer install`, `mix test`, `swift build/test`, `flutter test`, `docker build`, `terraform plan/init` |

**Never wrapped:** anything piped or redirected (`| tail`, `> out.txt`, `2>&1 |`), backgrounded (`&`), or long-running (`--watch`, `dev`, `serve`, `start`, `preview`, `nodemon`, `--ui`). Those either need live output or are already bounded.

**Bounded rules** (denied with a hint unless the bound is present):

| Command | Allowed when it has | Hint given to the agent |
|---|---|---|
| `git log` | `-n N`, `-N`, `--max-count`, a range `a..b`, `-L`, `--since` | add `-n 20` |
| `git diff` / `git show` | `--stat`, `--name-only`, a path after `--`, … | Measured first with `git diff --shortstat`; denied only if over 400 changed lines |
| `ls -R`, `dir /s` | (always denied) | grep the repo map, or `git ls-files <dir>` |
| `tree` | `-L N` | `tree -L 2` |
| `Get-ChildItem -Recurse` | `-Depth`, `-Filter`, `-Include` | add `-Depth 2` or `-Filter` |
| `find .` | `-maxdepth`, `-name`, `-path`, … | add `-maxdepth` or `-name` |
| `docker/kubectl/podman logs` | `--tail N`, `--since` | add `--tail 100` |
| `journalctl` | `-n N`, `--since` | add `-n 100` |

A bound piped into `head`/`tail` also counts, because piped commands are not checked.

**Blocked file paths** (config `guard.blockPaths`, regular expressions):
- dependency and build folders: `node_modules/`, `dist/`, `build/`, `target/`, `obj/`, `coverage/`, `.next/`, `.venv/`, `__pycache__/`, …
- lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `go.sum`, …
- minified, maps, snapshots, logs and binaries: `*.min.js`, `*.map`, `*.snap`, `*.log`, images, archives, …

Add exceptions with `guard.allowPaths`.

### 4.3 Rewrite or deny: what you see

The guard turns a verbose command into one of two forms. `src/lib/rules.mjs` (`wrapCommand`) picks the form:

| Original command | Rewritten command (what your approval prompt shows) |
|---|---|
| `npm test` (only letters, digits, spaces and `-_./:=@%+,`) | `node "D:/code/repo/.tokenkit/tk.mjs" run --shell powershell -- npm test` |
| `cd api; dotnet test --filter "Name~Cart"` (quotes, `;`, `&&`, `$`, …) | `node "D:/…/tk.mjs" run --shell powershell --b64 Y2QgYXBp… # cd api; dotnet test --filter "Name~Cart"` |

- **Why base64 for complex commands?** Quoting rules differ between PowerShell 5.1, PowerShell 7, bash and cmd. Base64 carries the exact original command through any shell. The trailing `# …` comment, which both bash and PowerShell ignore, shows you the real command.
- **Why `--shell`?** The command was written for the agent's terminal. `tk` runs it in the same kind of shell: PowerShell on Windows unless the tool is bash, or as set in `guard.shell`.
- **Forged-wrapper check.** A `--b64` wrapper is accepted only if its decoded command is one the guard itself would wrap (a verbose command) and it matches the trailing comment. Anything else is denied. This stops the base64 form from being used to hide a command from your review.
- **Deny mode** (`"commands": "deny"`) sends the same command back as text in the deny reason. The agent then runs it itself, at the cost of one short extra step.

### 4.4 The self-healing fallback

Rewriting depends on the harness applying the rewritten input. VS Code 1.141 does ([section 10](#10-limits-and-evidence)), but older or future builds might not. tokenkit checks rather than assumes:

1. The guard rewrites `npm test`.
2. After the command runs, `post.mjs` looks at the result. Every `tk` output starts with `[tk] `.
3. If a verbose, unwrapped command ran without that header, the rewrite was ignored. `post.mjs` writes `{"localRewriteIgnored": true}` to `.tokenkit/logs/state.json` and logs `fallback` in `guard.jsonl`.
4. From then on the guard uses deny mode in VS Code, which works on every build.

To retry rewriting after a VS Code update, delete `.tokenkit/logs/state.json`.

### 4.5 The post hook (`hooks/post.mjs`, postToolUse)

- **Always:** appends `{tool, target, tokens}` to `.tokenkit/logs/tools.jsonl`. This feeds `tk report`.
- **Copilot CLI only:** if a successful tool result is over 1,500 tokens (`post.minTokens`), it replaces the result with a compressed version via `modifiedResult`. Shell output goes through the full compressor; other tools keep the first 60 and last 15 lines. The original is saved to `.tokenkit/logs/tool-<timestamp>.log`, and the replacement says where it is. If compression would save less than 20%, the result is left alone.
- **Never trims:** file reads, edits and file creation (the agent needs exact content), failed results, or output already produced by `tk`.
- **VS Code:** only logs. VS Code's PostToolUse can append notes but cannot replace a result, which is why compression in VS Code happens before the command runs (the rewrite).

### 4.6 The session hook (`hooks/session.mjs`, sessionStart)

Rebuilds `.tokenkit/repomap.md` if it is stale: missing, older than 60 minutes (`map.maxAgeMinutes`), listing a different number of source files, or older than any source file. The prompt hook runs the same check before matching, so files the agent created a minute ago are already in the map. It returns nothing, so the start of every prompt stays identical across sessions, which keeps the prompt cache warm.

### 4.7 The prompt hook: plain-language requests

`hooks/prompt.mjs`, on `userPromptSubmitted`. You don't have to write TaskSpec. When you type an ordinary request, this hook runs before the model sees it and tries to answer one question: *where should the agent start reading?* If it is confident, it attaches a short note. VS Code appends that note to your request before the agent's first step (verified in VS Code's code), so the agent can skip the search, list and read calls it would otherwise spend finding the code.

```text
You type:     the discount is applied wrong, 10 percent off 200 gives -1800
Hook adds:    [tokenkit] Likely locations for this request (repo-map match on: discount, applied).
              Read these ranges first; search only if they turn out wrong:
              - src/cart/discount.ts:1-4  applyDiscount
```

**How it decides** (`src/lib/locate.mjs`; no AI, no network, same input gives same output):

1. **Pull cues from your text.**
   - *Identifiers*: backticked words and code-looking words (`placeOrder`, `order_id`, `Cart.total`).
   - *File names*: `cart.ts`, `src/auth/login.ts`.
   - *Plain words*: everything else, minus about 200 stopwords such as "fix", "bug", "the", "please", "function".
   - *Joined pairs*: adjacent words glued together, so "repo map" also tries `repomap`.
2. **Stem every word** with a light suffix stemmer. "applied" = "apply", "validation" = "validate", "orders" = "order", but "repo" ≠ "report" and "check" ≠ "checkout". Code names are split into words first: `applyDiscount` → apply + discount.
3. **Score every symbol in the repo map:**

| Match | Points |
|---|---|
| An identifier you wrote equals the symbol name | 10 (8 if only the letter case differs, or a joined pair matches) |
| Each of your words that matches a word of the symbol name | 3, plus 2 if all its words matched |
| You named the file (`cart.ts`) | +10 to every symbol in it |
| A word matches the file name (`guard` → `guard.mjs`) | +6 |
| A word matches a folder name (`checkout/`) | +2 each |

4. **Keep only confident matches.** A hint must score at least 5 (`prompt.minScore`) and at least half the best score. Ties go to methods over their class, because methods are smaller ranges to read. There are at most 5 hints and at most 2 per file. Over 20 weak matches means the prompt is too vague, so nothing is injected.
5. **Resolve exact ranges** by re-reading each hinted file with the repo map's extractors, so the note says `:1-4`, not just a start line.
6. **Write a note of at most 6 lines** (about 40 to 80 tokens), or **nothing at all**. "Can you help me?", "update the readme" (not source code) and "thanks!" get no note.

If your message is a TaskSpec line instead, the hook attaches its full expansion, with `#Symbol` resolved to exact lines.

**See it for yourself.** `tk locate` runs the same code and prints the same note, and `--why` shows the cues and scores:

```text
$ node .tokenkit/tk.mjs locate --why "refresh token expires too early in the session store"
[tokenkit] Likely locations for this request (repo-map match on: refreshToken, session, SessionStore). …
- src/auth/session.ts:2-5  SessionStore.refreshToken
- src/auth/session.ts:1-5  SessionStore
  score 14  src/auth/session.ts:2-5  matched: refreshToken, session
  score 14  src/auth/session.ts:1-5  matched: SessionStore, session
```

Here "refresh token" matched as a joined pair (8 points), plus the file name `session` (6). The tie went to the method.

**Limits.** Matching works on names. A request phrased entirely in words that don't appear in any file, class or function name gets no hint, and the agent searches as usual. Naming another module in passing can pull that module into the hints. The note says "search only if they turn out wrong" for this reason. Copilot CLI ignores this hook's output, so the hints are VS Code only.

---


## 5. Layer C: the `tk` command-line tool

`node .tokenkit/tk.mjs <command>` (or `node <toolkit>/src/tk.mjs` from the source checkout). It needs Node 18 or later and has no dependencies.

### 5.1 `tk run`: run a command, return compact output

```text
node .tokenkit/tk.mjs run -- npm test
node .tokenkit/tk.mjs run --shell powershell -- dotnet test -v q
node .tokenkit/tk.mjs run "pytest -k 'cart and not slow'"     # one quoted string: passed to the shell as-is
node .tokenkit/tk.mjs run --raw -- npm test                     # full output, still logged
```

What happens, in order:

1. **Run.** The command is started with `CI=1`, `NO_COLOR=1` and `FORCE_COLOR=0`, which most tools respect by printing fewer progress bars and no colors. Shell choice: `--shell bash` → `bash -c`, `--shell powershell` → `powershell.exe -NoProfile -Command` (`pwsh` on macOS/Linux), otherwise the platform default. stdout and stderr are captured together, in order.
2. **Save.** The full output goes to `.tokenkit/logs/last.log` and to `run-<timestamp>.log`; the last 10 are kept. A stats line goes to `runs.jsonl`.
3. **Compress** (5.2) and print, starting with a status header:

```text
[tk] FAILED exit 1 in 1.9s · 1540→29 lines, ~10k→307 tokens · full log: .tokenkit/logs/last.log
[tk] 250 passing-test line(s) hidden; 1255 progress/noise line(s) hidden; 6 library stack-frame line(s) collapsed
```

4. **Exit with the command's own exit code**, so the agent still sees success or failure. A timeout (`run.timeoutSec`) exits 124.

### 5.2 How compression works

The compressor (`src/lib/compress.mjs`) is a fixed pipeline of text rules, with no AI involved. Same input, same output.

1. **Normalize.** Remove ANSI color codes. For lines redrawn with carriage returns (progress bars), keep only the final state. Trim trailing spaces.
2. **Drop noise:** progress bars and percentages, spinners, `npm warn/notice`, pip `Collecting/Downloading`, git `Counting objects`, NuGet restore chatter, Maven/Gradle downloads, cargo `Compiling x v1.2`, `go: downloading`, Docker layer lines, TAP bookkeeping (`# Subtest:`, `duration_ms:`, `---`/`...`). Each is counted.
3. **Drop passing tests:** `✓`, `PASS`, `PASSED`, `ok N -`, `--- PASS:`, `test x ... ok`, `[ OK ]`, `Passed`, pytest dot rows. A line is never dropped if it also contains "fail" or "error".
4. **Collapse library stack frames.** Runs of frames from `node_modules`, `node:internal`, Java/.NET framework packages, Python `site-packages` (with their code line), Rust std and Go runtime become one line: `… 6 library frame line(s)`. Frames from your own code stay.
5. **De-duplicate.** Identical consecutive lines become one line with `(×N)`.
6. **Collapse same-shape runs.** Five or more consecutive lines that differ only in numbers or quoted text (`copying file 17 of 300`) keep the first two, a `… +N similar line(s)` marker and the last one. Error lines are never collapsed, because each may name a different location.
7. **Select what fits.** If the result is still over the cap, keep the first 6 lines, the last 20, and every error line with 2 lines of context. Error lines match error, fail, exception, panic, traceback, assert, expected, received, `✗`, `●`, `> 12 |` code pointers, and so on. The cap is 80 lines on failure; on success it is 16, keeping the last 8 lines plus any error-like lines. Gaps are marked `… [N line(s) omitted]`. If error windows overflow the cap, the earliest errors are kept, because later ones are often cascades.
8. **Notes.** One line says what was hidden, including a count of warning lines left in the full log.

**Real example** (from the demo; 1,540 lines in, 29 out). The raw output starts like this and repeats it 250 times:

```text
TAP version 13
# Subtest: cart adds item 0
ok 1 - cart adds item 0
  ---
  duration_ms: 3.6749
  type: 'test'
  ...
# Subtest: cart adds item 1
...
```

What the agent receives:

```text
[tk] FAILED exit 1 in 1.9s · 1540→29 lines, ~10k→307 tokens · full log: .tokenkit/logs/last.log
[tk] 250 passing-test line(s) hidden; 1255 progress/noise line(s) hidden; 6 library stack-frame line(s) collapsed
> test
> node --test

TAP version 13
not ok 251 - discount is a percentage
  location: '…\test\cart.test.js:254:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    -1800 !== 180

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 180
  actual: -1800
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///…/test/cart.test.js:254:49)
    … 6 library frame line(s)
1..251
# tests 251
# suites 0
# pass 250
# fail 1
…
```

**Nothing is lost.** The full output is always on disk. The agent is told to grep the log for more detail instead of reading it whole.

### 5.3 `tk filter`: compress piped output

```text
some-command 2>&1 | node .tokenkit/tk.mjs filter            # treated as a failure (keeps errors, head, tail)
some-command 2>&1 | node .tokenkit/tk.mjs filter --exit 0   # treated as success (short tail)
```

Same pipeline as `tk run`, for output you already have.

### 5.4 The repo map

`.tokenkit/repomap.md` is a one-line-per-file symbol index, built by `tk map` and refreshed by the session hook:

```text
# Repo map · 214 source files · detail level 0/4 · regenerate: node .tokenkit/tk.mjs map
# path | Symbol:line .method:line — grep this file for a name, then read only that line range.
src/auth/login.ts | validateUser:12 LoginForm:40 .submit:52 .reset:61 hashPw:88
src/cart.js | Cart:1 applyDiscount:6
```

How it is built (`src/lib/repomap.mjs`):

1. **List files** with `git ls-files` (respects `.gitignore`), or by walking the folder if it's not a git repo. Dependency and build folders, generated files (`*.min.*`, `*.d.ts`, `*.g.cs`, `*_pb2.py`, …), files over 256 KB and `map.exclude` patterns are skipped.
2. **Extract symbols** with per-language regular expressions: TypeScript/JavaScript (also `.vue`, `.svelte`), Python, Go, C#, Java/Kotlin/Scala, Rust, PHP, Ruby. Top-level functions, classes, types and exports are taken, plus up to 15 public methods per file, shown as `.method`.
3. **Fit the budget** (`map.maxTokens`, 4,000 by default) by dropping detail until it fits: level 0 everything, 1 no methods, 2 no symbols in test files, 3 paths only, 4 directory counts only.

The agent greps the map for a name and gets the file and line in one call, then reads only that range. Without it, finding code typically takes several search, list and read calls, each a full round-trip.

### 5.5 TaskSpec

TaskSpec is a one-line notation that puts scope, constraints and answer shape in the request, so the agent doesn't spend tool calls or questions discovering them. It is **optional**: plain language gets location hints automatically ([4.7](#47-the-prompt-hook-plain-language-requests)). TaskSpec is for when you want exact control. Full reference: [TASKSPEC.md](TASKSPEC.md).

```text
<verb> [@path[:L1-L2|#Symbol]]... <goal> [flags]

fix @src/cart.js#applyDiscount pct is a percentage +test >diff
```

How it works:
- The model learns the notation from the 6-line legend in the instructions block. You type it straight into chat; no preprocessing.
- `tk spec "<line>"` shows the full expansion and resolves `#Symbol` to exact lines using the same extractors as the repo map. Use it to check a spec, or to feed Copilot CLI.
- Verbs and flags are defined once in `src/lib/spec.mjs`. A test fails if the legend in the instructions template drifts from the code.

```text
$ node .tokenkit/tk.mjs spec "fix @src/cart.js#applyDiscount pct is a percentage +test >diff"
Task: Fix: pct is a percentage
Scope: src/cart.js lines 6-7 (applyDiscount). Read only these ranges first; open other files only if strictly required.
Constraints: Add or update tests that cover the change; run only those tests.
Output: make the edits, then reply with one line naming the changed files. No explanation.
```

### 5.6 `tk budget`: what is sent on every request

`tk budget [dir] [--ci]` lists everything Copilot loads on every request, with estimated tokens, then flags problems:

- **Always-on files:** `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, any `*.instructions.md` with `applyTo: "**"`, and each skill's name and description.
- **Loaded on demand:** path-scoped instructions, skill bodies, agents and prompt files.
- **Findings:**
  - several root instruction files loaded together;
  - lines duplicated across them;
  - filler words ("please", "make sure to", "it is important that");
  - code blocks over 8 lines or paragraphs over 400 characters in always-on files;
  - `applyTo: "**"`;
  - a skill `name` that doesn't match its folder (the skill is silently skipped);
  - skill descriptions over 300 characters;
  - agents or prompts with no `tools:` list;
  - legacy `.chatmode.md` files;
  - MCP servers in `.vscode/mcp.json`.
- `--ci` exits 1 when always-on context is over `budget.alwaysOnTokens` (1,200), so CI can stop instructions from growing back.

Token counts in `tk` are estimates: a dependency-free heuristic, accurate to about ±20%.

### 5.7 `tk report`: what was saved

`tk report [--days 7]` reads the logs and prints:

```text
tk run        14 run(s): ~142k → ~4.1k tokens (97% kept out of context)
post-compress 3 output(s): ~21k → ~2.6k tokens (88%)
prompts       22 prompt(s): 15 got location hints, 3 TaskSpec expansion(s), ~1.2k tokens added
guard         9 intervention(s): rewrite:verbose×6, deny:unbounded×2, deny:blocked-path×1

Tool output reaching the model (by tool):
   tokens  calls    max  tool
    18.2k     41   3.1k  read_file
     4.1k     14    450  run_in_terminal
...
Largest single outputs:
     3.1k  read_file  src/legacy/orders.ts
```

The numbers above are illustrative. Use the "largest single outputs" list to decide what to tune next: a quiet flag in `lean-verify`, a `guard` rule, or a `run.noise` pattern.

### 5.8 `tk install`: put tokenkit into repositories

`node <toolkit>/src/tk.mjs install <repo>... [--force] [--dry-run]`

1. Copies the runtime (`src/`) to `<repo>/.tokenkit/`. It keeps the repo's `config.json`, logs and map.
2. Copies each template file:
   - **missing:** created;
   - **identical:** unchanged;
   - **`copilot-instructions.md`:** the marked block is merged in or replaced;
   - **written by tokenkit and unchanged since** (its hash matches `.tokenkit/manifest.json`): upgraded to the new version;
   - **edited by you, or not created by tokenkit** (for example your own `.vscode/settings.json`): skipped and reported. `--force` overwrites.
3. Adds `.tokenkit/logs/`, `.tokenkit/repomap.md` and `.tokenkit/handoff.md` to `.gitignore`.
4. Builds the first repo map.

---

## 6. Install and verify

For a click-by-click walkthrough with expected output at every step, see **[INSTALL.md](INSTALL.md)**. This section is the short version.

### Prerequisites

- VS Code with GitHub Copilot (agent mode), and Node.js 18 or later on PATH (`node -v`).
- A trusted workspace. VS Code does not run workspace hooks in untrusted folders.
- Hooks allowed by your organization's Copilot policy. If not, see [below](#if-your-organization-disables-hooks).

### Install

```powershell
# keep the toolkit folder somewhere stable, then:
node D:\Learning\practical-ai-agents\TokenOptimizations\src\tk.mjs install D:\code\repo-a D:\code\repo-b
```

Commit `.github/` and `.tokenkit/` (generated files are already gitignored), so teammates and the Copilot cloud agent get the same setup. If the repo already had `.vscode/settings.json`, merge these keys by hand: `search.exclude` (keeps build output out of agent search), `chat.tools.compressOutput.enabled: true` (VS Code's own terminal-output compression, Preview), `chat.useHooks: true` and `chat.useAgentSkills: true`.

### Verify (about 2 minutes)

1. **Reload the window.** Then run **Command Palette → Chat: Configure Hooks**: `.github/hooks/tokenkit.json` should be listed.
2. **In agent mode, ask "run the tests".** The approval prompt should show `node ".../.tokenkit/tk.mjs" run … -- <your test command>`, and the output should start with `[tk] OK` or `[tk] FAILED`.
3. **If not:** open **Output → GitHub Copilot Chat Hooks** to see whether the hooks ran and what they returned.
4. **Ask "show me git log".** The guard should deny the unbounded form and the agent should retry with `-n 20`.
5. **Run `node .tokenkit/tk.mjs budget`.** Always-on context should be well under the 1,200-token budget.
6. **After a day of use, run `node .tokenkit/tk.mjs report`.**

### If your organization disables hooks

VS Code hooks are a Preview feature, and enterprise policy can turn them off. Then Layer B doesn't run, but nothing breaks:

- **Still active:** the instructions and skills tell the agent to use `tk run`, the repo map, ranged reads and terse answers. TaskSpec, `/q`, `/handoff` and the lean agent work as before.
- **Lost:** enforcement for the times the agent forgets, and tool-size logging. `tk report` then shows only `tk run` statistics.

---

## 7. Daily use

### A good default workflow

1. **New chat per task.** Choose the model first (Auto, or a small model for routine work) and don't switch mid-task: switching models or tools breaks the prompt cache.
2. **Write the request the way you normally would.** The prompt hook attaches likely locations. Name what you know: a function or class in backticks, a file name, or the words used in the code ("discount", "shipping", "session"). Those are what it matches.
   ```text
   the discount is applied wrong: 10 percent off 200 gives -1800
   `placeOrder` is slow when the cart has 100+ items
   ```
   Switch to TaskSpec when you want exact scope or a fixed answer shape:
   ```text
   fix @src/cart.js#applyDiscount pct is a percentage, not a fraction +test >diff
   ```
3. **Let the agent work.** Approve the `tk run` commands as usual.
4. **For multi-part work,** run `/handoff`, then start a new chat with `#file:.tokenkit/handoff.md continue`.
5. **Weekly,** check `tk report` and act on the biggest outputs.

### TaskSpec cheat sheet

| Part | Options |
|---|---|
| Verbs | `fix` `add` `ref` (refactor) `test` `rev` (review, report only) `explain` `doc` `perf` |
| Scope | `@file`, `@file:40-90`, `@file#Symbol` (several allowed) |
| Answer shape | `>diff` edit, then a one-line reply · `>plan` at most 7 bullets, no edits · `>ans` at most 5 lines, no edits |
| Constraints | `+test` add or adjust tests and run only those · `^min` smallest change · `^api` keep public API · `^nodeps` no new dependencies · `!run` don't run builds or tests |

```text
rev @src/api/orders.ts:40-120 >ans
add @src/routes/users.ts rate-limit POST /login to 10/min per IP ^nodeps +test
ref @lib/parser.py#tokenize split into smaller functions ^api ^min !run
explain @internal/cache/lru.go#Evict >ans
```

Prefer `@path:range` over VS Code's `#file:` for big files. `#file` pastes the whole file into the prompt, while `@path:range` lets the agent read just the part it needs.

### Commands you'll use

| Command | When |
|---|---|
| `node .tokenkit/tk.mjs run -- <cmd>` | Run anything noisy yourself, or see what the agent sees |
| `node .tokenkit/tk.mjs map` | After big refactors (otherwise it refreshes hourly) |
| `node .tokenkit/tk.mjs spec "<taskspec>"` | Check a spec, or see the lines a `#Symbol` resolves to |
| `node .tokenkit/tk.mjs locate --why "<request>"` | See the hint a plain-language request would get, and why |
| `node .tokenkit/tk.mjs budget` | After editing instructions, skills or agents |
| `node .tokenkit/tk.mjs report` | Weekly, to see savings and the next thing to tune |
| `node <toolkit>/src/tk.mjs install <repo>` | To add or upgrade tokenkit in a repo |
| `node .tokenkit/tk.mjs doctor` | Health check: runs every hook with sample input |
| `node <toolkit>/src/tk.mjs usage <folder>` | VS Code's own record of chat sessions for a folder (tool calls, context size, prompt breakdown, credits); works without tokenkit, so use it to compare ([COMPARE.md](COMPARE.md)) |
| `node <toolkit>/src/tk.mjs uninstall <repo>` | Remove what install added (keeps files you edited) |

### Where to look when you need the full output

| File in `.tokenkit/logs/` | Contains |
|---|---|
| `last.log` | Full output of the latest `tk run` (first two lines: the command and the exit code) |
| `run-<timestamp>.log` | The same for the last 10 runs |
| `tool-<timestamp>.log` | Originals of outputs compressed by the post hook (Copilot CLI) |
| `runs.jsonl`, `tools.jsonl`, `guard.jsonl`, `prompt.jsonl` | Statistics behind `tk report` |
| `state.json` | Self-healing flags ([4.4](#44-the-self-healing-fallback)) |
| `errors.jsonl` | Hook errors (hooks never fail loudly) |

---

## 8. Configuration reference

Create `.tokenkit/config.json` with only the keys you want to change. Everything else keeps its default. Lists such as `blockPaths` *replace* the default list, so copy the defaults from `src/lib/config.mjs` if you extend them.

| Key | Default | Effect |
|---|---|---|
| `guard.commands` | `"auto"` | `auto`/`rewrite`: wrap verbose commands in place (with the [fallback](#44-the-self-healing-fallback)). `deny`: deny with the exact re-run command. `off`: leave them alone. |
| `guard.reads` | `"deny"` | `deny` blocks lockfile, generated and huge reads; `off` disables |
| `guard.bounded` | `"deny"` | `deny` requires bounds on `git log`, recursive listings and logs; `off` disables |
| `guard.shell` | `"auto"` | Shell for rewritten commands. `auto` = PowerShell on Windows, bash elsewhere. Set `"bash"` if your VS Code terminal is Git Bash. |
| `guard.maxReadKB` | `48` | Whole-file reads above this size need a line range |
| `guard.blockPaths` | see 4.2 | Regular expressions for paths never to read |
| `guard.allowPaths` | `[]` | Regular expressions that override `blockPaths`, e.g. `"^docs/generated/"` |
| `run.maxLines` | `80` | Maximum lines returned on failure |
| `run.headLines` / `run.tailLines` | `6` / `20` | Lines always kept from the start / end on failure |
| `run.successTail` | `8` | Lines kept on success (the cap is twice this) |
| `run.context` | `2` | Lines kept around each error line |
| `run.timeoutSec` | `0` | Kill the command after N seconds (0 = never); exit code 124 |
| `run.keepLogs` | `10` | Number of `run-*.log` files kept |
| `run.noise` | `[]` | Extra regular expressions for lines to drop (e.g. your app's banner) |
| `run.errors` | `[]` | Extra regular expressions for lines always to keep (e.g. `"^MYAPP-E\\d+"`) |
| `post.minTokens` | `1500` | Copilot CLI: compress tool outputs above this |
| `post.otherHead` / `post.otherTail` | `60` / `15` | Copilot CLI: lines kept from non-shell tool outputs |
| `prompt.hints` | `"on"` | `off` stops plain-language location hints (TaskSpec expansion stops too) |
| `prompt.maxHints` | `5` | Most locations in one note |
| `prompt.minScore` | `5` | Confidence floor; raise to 8 for fewer, surer hints (scoring table in [4.7](#47-the-prompt-hook-plain-language-requests)) |
| `map.maxTokens` | `4000` | Repo map budget |
| `map.maxAgeMinutes` | `60` | The session hook rebuilds an older map |
| `map.maxFileKB` | `256` | Larger files are not indexed |
| `map.exclude` | `[]` | Regular expressions for paths to leave out of the map |
| `budget.alwaysOnTokens` | `1200` | `tk budget --ci` fails above this |
| `budget.skillDescriptionChars` | `300` | Longer skill descriptions are flagged |

Environment overrides, mainly for tests: `TOKENKIT_CONFIG` (path to a config file) and `TOKENKIT_LOG_DIR` (log folder).

### Optional: skip approval for wrapped test and build runs

VS Code checks your terminal auto-approve rules against the rewritten command, so an existing rule for `npm test` won't match `node … tk.mjs run -- npm test`. This rule approves only the readable wrappers of those exact commands. Base64 wrappers and anything else still prompt. It's a restricted setting, so put it in your **user** settings:

```jsonc
"chat.tools.terminal.autoApprove": {
  "/^node \"[^\"]*\\.tokenkit\\/tk\\.mjs\" run --shell \\w+ -- (npm|pnpm|yarn) (test|run (test|lint|build|typecheck))$/": { "approve": true, "matchCommandLine": true }
}
```

Adapt the end of the pattern to your own commands, such as `dotnet test`. Keep it narrow.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `tokenkit.json` not listed in **Chat: Configure Hooks** | Untrusted workspace, `chat.useHooks` off, or org policy | Trust the folder; check the setting; ask your admin about the Copilot hooks policy |
| Test output is not compressed (no `[tk]` line) | Hooks not running, or the command is piped, redirected or long-running | Check the **GitHub Copilot Chat Hooks** output channel; run without the pipe |
| Agent gets `[tokenkit] … Re-run through the output compressor` | Deny mode, or the fallback is active | Expected. Delete `.tokenkit/logs/state.json` to retry rewriting. |
| Rewritten command fails with PowerShell syntax errors, but your terminal is Git Bash | The guard assumed PowerShell on Windows | Set `"guard": { "shell": "bash" }` |
| `Cannot find module …/tk.mjs` | The agent's terminal was in a subfolder, or `.tokenkit/` was never committed | Rewrites use an absolute path; for deny-mode commands, `cd` to the repo root. Commit `.tokenkit/`. |
| A file you need is blocked | It matches `guard.blockPaths` | Add a pattern to `guard.allowPaths`, or read a range with grep |
| You now get approval prompts for tests that were auto-approved | Rules are checked against the rewritten command | Add the narrow rule from [section 8](#optional-skip-approval-for-wrapped-test-and-build-runs) |
| Too much was cut from an output | Error pattern not recognized | Add a `run.errors` pattern, raise `run.maxLines`, or grep `last.log` |
| A plain-language request got no `Likely locations` note | It names nothing found in file, class or function names, or the map is stale | Check with `tk locate --why "…"`; mention the function or file; run `tk map` |
| Hints point at the wrong code | A word matched a different module | Name the identifier in backticks, or raise `prompt.minScore` to 8 |
| Repo map is missing a language or symbol | Regex-based extraction | `map.exclude` for noise; add patterns in `src/lib/repomap.mjs` ([section 11](#11-extending-tokenkit-and-code-map)) |
| Anything unexplained | | Look in `.tokenkit/logs/errors.jsonl` and `guard.jsonl` |

---

## 10. Limits and evidence

**Verified:**
- **Automated tests:** 39 tests (`npm test`) cover location hints for plain-language requests on a sample app, the compressor (Jest, TAP, pytest and TypeScript samples), repo map extraction for 5 languages, guard decisions in both payload dialects, the forged-wrapper check, the self-healing fallback, the post hook, TaskSpec, budget findings and install/upgrade.
- **Measured:** 1,540 lines (~10k tokens) became 29 lines (~300 tokens) on a 251-test Node project. The run was replayed with the exact hook commands, spawned three ways (PowerShell argument, cmd, `shell: powershell.exe`), on Windows.
- **Checked in VS Code's own code** (VS Code 1.141.0, Copilot Chat 0.69.0):
  - `updatedInput` is applied without a permission decision, after validation against the tool's schema;
  - a PostToolUse `block` only appends a note;
  - the Copilot-format hook file maps `powershell`→Windows, `bash`→Linux/macOS and `timeoutSec`→timeout;
  - `hookSpecificOutput` is kept only when `hookEventName` matches;
  - `UserPromptSubmit` receives your prompt text, and its `additionalContext` is appended before the agent's first step; `userPromptSubmitted` maps to it;
  - the terminal tool's input fields are `command`, `explanation`, `goal`, `mode`, `isBackground` and `timeout`.

**Limits:**
- **VS Code can't compress after the fact.** Tasks (`create_and_run_task`), `testFailure` and MCP tools don't go through the terminal, so their output can't be compressed in VS Code; it is only logged. VS Code's `runTests` tool reports results from the Test Explorer rather than raw console output, so it is usually compact already.
- **Preview features:** VS Code hooks and `chat.tools.compressOutput` may change between releases. The fallback covers ignored rewrites; `src/lib/hookio.mjs` is the one place to adapt field names.
- **Not tested inside a live chat session.** Hooks were exercised with the exact payloads VS Code documents and builds, not by an actual model in the chat panel. Step 2 of [Verify](#verify-about-2-minutes) is that test.
- **Estimates and heuristics:** token counts are approximate (±20%). The repo map uses regular expressions, not a parser. The verbose-command list covers common tools only; add yours.

---

## 11. Extending tokenkit and code map

| File | Responsibility |
|---|---|
| `src/tk.mjs` | CLI entry: argument parsing, dispatch to the libraries |
| `src/lib/compress.mjs` | The compression pipeline (noise, pass, frame and error patterns) |
| `src/lib/run.mjs` | `tk run`: shell choice, environment, logs, exit code |
| `src/lib/rules.mjs` | Command classification (verbose, bounded, read), `wrapCommand`, forged-wrapper check |
| `src/lib/hookio.mjs` | Hook stdin/stdout for both dialects, logging, state, `commandMode` |
| `src/hooks/guard.mjs` | preToolUse decisions |
| `src/hooks/post.mjs` | postToolUse logging, Copilot CLI compression, fallback detection |
| `src/hooks/session.mjs` | sessionStart repo-map refresh |
| `src/hooks/prompt.mjs` | userPromptSubmitted: location hints or TaskSpec expansion |
| `src/lib/locate.mjs` | Cue extraction, stemmer, scoring, hint text (`tk locate`) |
| `src/lib/repomap.mjs` | File listing, symbol extractors, budget levels, `findSymbol` |
| `src/lib/spec.mjs` | TaskSpec verbs, flags, legend, parser, expander |
| `src/lib/budget.mjs` | Always-on audit and lint rules |
| `src/lib/report.mjs` | Log aggregation for `tk report` |
| `src/lib/install.mjs` | Install, merge block, manifest-based upgrades |
| `src/lib/config.mjs` | Defaults and config loading |
| `src/lib/tokens.mjs` | Token estimate |
| `templates/` | Everything copied into repositories |

**Common extensions:**
- **A command that should be compressed:** add a regular expression to `VERBOSE` in `src/lib/rules.mjs`.
- **Noise your tools print:** add to `run.noise` in config (per repo) or to `NOISE` in `compress.mjs` (for everyone).
- **A new language in the repo map:** add an entry to `LANGS` in `repomap.mjs` with `ext`, `top` patterns and optionally `cls`/`method`, and add a test in `test/repomap.test.mjs`.
- **A new TaskSpec verb or flag:**
  1. Edit `VERBS` / `FLAG_DEFS` in `spec.mjs`.
  2. Run `node src/tk.mjs spec --legend`.
  3. Paste the output into `templates/.github/copilot-instructions.md`.
  4. Run `npm test`.
- **A new rule for the agent:** prefer a skill (loaded on demand) or a path-scoped `.instructions.md` over the always-on block. Then run `tk budget`.

After any change, run `npm test` in the toolkit folder. Then re-run `install` on your repositories: untouched files are upgraded, and files you edited are kept.
