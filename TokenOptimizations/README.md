# tokenkit: spend fewer Copilot AI credits

Since **June 1, 2026**, GitHub Copilot bills **AI credits** (1 credit = $0.01). They are charged for input, cached-input and output tokens at each model's API rate. Code completions and Next Edit Suggestions remain free. ([changelog](https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/), [pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing))

```
cost of an agent session ≈ Σ over every model call (each agent step):
    new input × input price  +  cached input × ~10%  +  output × output price (5–8× input)
```

Each agent step re-sends the whole conversation, so **a 10k-token test log isn't paid once; it rides along on every later step**. tokenkit removes the expensive parts automatically, and gives you habits and a task notation for the rest.

> **Install it: [docs/INSTALL.md](docs/INSTALL.md)** (step by step, about 10 minutes).
> **Measure it: [docs/COMPARE.md](docs/COMPARE.md)** (a fair with/without comparison, token-heavy prompts, `tk usage`).
> **Understand it: [docs/GUIDE.md](docs/GUIDE.md)** explains how every part works (hooks, compressor, repo map, TaskSpec), daily use, configuration and troubleshooting.

**Primary target: the VS Code Copilot extension (agent mode).** Everything also works in Copilot CLI and the cloud agent if your org enables them, and degrades gracefully if your org disables hooks.

## What's in the box

| Piece | What it does | VS Code | Copilot CLI |
|---|---|---|---|
| **Instructions block** | ~500 always-on tokens: terse output, find-then-read, run commands via `tk`, bounded commands, TaskSpec legend. | ✓ | ✓ |
| **4 skills** | `lean-explore`, `lean-verify`, `handoff`, `context-audit`. About 55 tokens each always-on (name + description); bodies load only when relevant. | ✓ | ✓ |
| **`lean` agent** | Minimal toolset (tool schemas are input tokens on every call), terse replies, optional cheap-model pin. | ✓ | — |
| **`/q`, `/handoff`, `/spec`** | `/q` is a small model with no tools. `/handoff` writes a 25-line checkpoint so you can start a fresh session. `/spec` runs a TaskSpec. | ✓ | — |
| **TaskSpec** | One-line notation (`fix @src/a.ts#login null user +test >diff`) that front-loads scope, constraints and answer shape. See [docs/TASKSPEC.md](docs/TASKSPEC.md). | ✓ | ✓ |
| **prompt hook** (on submit) | Plain-language requests get up to 5 "likely locations" (file, line range, symbol) matched from the repo map, attached before the agent starts. A TaskSpec line gets its expansion. Vague prompts get nothing. Preview with `tk locate --why "…"`. | ✓ | — (output ignored) |
| **guard hook** (pre-tool) | Verbose build/test/install commands → `tk run`. Denies lockfile, generated and huge whole-file reads, unbounded `git log`, recursive listings and `docker logs`, each with a bounded alternative. Denies forged `tk --b64` wrappers. | ✓ rewritten in place | ✓ rewritten in place |
| **post hook** (post-tool) | Logs every tool output's size for `tk report`. In the CLI it also replaces oversized output with a compressed version. | logs only¹ | ✓ compresses |
| **session hook** | Refreshes `.tokenkit/repomap.md` when stale. Injects nothing, so the prompt cache stays warm. | ✓ | ✓ |
| `tk run` | Output compressor: errors with context, head, summary tail. Drops passing tests, progress bars and library frames, and keeps the full log. | ✓ | ✓ |
| **repo map** | Grep-able `path \| Symbol:line` index (≤4k tokens). One grep replaces several search/list/read calls. | ✓ | ✓ |
| `tk budget` / `tk report` | Measures always-on context, lints instruction bloat and MCP sprawl, and shows tokens kept out of context. | ✓ | ✓ |

¹ VS Code's PostToolUse hook cannot replace tool output (documented). In VS Code, compression comes from the guard routing commands through `tk run`, plus `chat.tools.compressOutput.enabled` (Preview), which the installer's settings template turns on.

**Measured** (VS Code hook flow, replayed with the exact hook command on Windows/PowerShell; Node test runner, 251 tests, 1 failing): raw `npm test` printed **1,540 lines (~10k tokens)**. The guard redirected it to `tk run`, which printed **29 lines (~300 tokens)**, a 97% cut, with the failing assertion, expected/actual values, user stack frame and summary intact.

## How it behaves in VS Code

1. The agent usually runs `node .tokenkit/tk.mjs run -- npm test` on its own, because the instructions tell it to.
2. If it calls `npm test` directly, the guard **rewrites that call in place** before it runs:
   `node "D:/code/repo/.tokenkit/tk.mjs" run --shell powershell -- npm test`. There's no extra step, and the agent gets the ~300-token result instead of ~10k.
3. Your approval prompt shows the rewritten command. Simple commands stay fully readable. Commands with quotes, `;` or `&&` get a base64 wrapper plus the original as a trailing `# comment`, and the guard rejects any wrapper whose payload doesn't match its comment or isn't a build/test command.
4. **Fallback:** if a VS Code build drops the rewrite (older builds, or a schema change), tokenkit notices on the first run (no `[tk]` header) and switches to *deny with the exact re-run command*, which costs one short extra step. Force that behavior with `"guard": { "commands": "deny" }`.

**Checked against VS Code's own code** (1.141 / Copilot Chat 0.69), beyond the public docs:
- `updatedInput` is applied without a permission decision, after validation against the terminal tool's schema (`command, explanation, goal, mode, isBackground, timeout`).
- A PostToolUse `block` only appends a note and never replaces output, which is why VS Code compression happens before the tool runs.
- The Copilot-format hook file maps `powershell`→`windows`, `bash`→`linux`/`osx` and `timeoutSec`→`timeout`.
- `hookSpecificOutput` is kept only when `hookEventName` matches the event.

**Optional: skip approval for wrapped test/build runs.** Rewritten commands are checked against your auto-approve rules as written, so a rule for `npm test` won't match its wrapped form. This is a restricted setting, so put it in your **user** settings:

```jsonc
"chat.tools.terminal.autoApprove": {
  "/^node \"[^\"]*\\.tokenkit\\/tk\\.mjs\" run --shell \\w+ -- (npm|pnpm|yarn) (test|run (test|lint|build|typecheck))$/": { "approve": true, "matchCommandLine": true }
}
```

It matches only readable wrappers of those exact commands; base64 wrappers still prompt.

## Install into your repos

Requires Node ≥ 18 on PATH. No dependencies.

```powershell
# keep this folder somewhere stable, then install into any number of repos:
node D:\Learning\practical-ai-agents\TokenOptimizations\src\tk.mjs install D:\code\repo-a D:\code\repo-b
```

The installer:
- copies the runtime to `<repo>/.tokenkit/` (vendored, so teammates and the cloud agent get it from git);
- adds `.github/hooks/tokenkit.json`, `.github/skills/*`, `.github/agents/lean.agent.md`, `.github/prompts/*` and `.github/instructions/testing.instructions.md`;
- **merges** a marked block into an existing `.github/copilot-instructions.md` (re-running replaces only that block);
- creates `.vscode/settings.json` only if the repo has none (otherwise merge [these keys](templates/.vscode/settings.json) by hand);
- gitignores logs, the map and handoff notes, then builds the first repo map.

**Upgrades:** re-run `install`. A manifest records what tokenkit wrote, so files you haven't touched are upgraded and files you edited are left alone (`--force` overrides).

### Verify in VS Code (2 minutes)

1. Commit or keep the files, then reload the window. **Workspace Trust** must be on for the repo, because hooks don't run in untrusted workspaces.
2. Command Palette → **Chat: Configure Hooks** should list `.github/hooks/tokenkit.json`.
3. In agent mode, ask: *"run the tests"*. You should see `[tk] OK …` or `[tk] FAILED …` output. **Output** panel → **GitHub Copilot Chat Hooks** shows hook runs and errors.
4. After a day: `node .tokenkit/tk.mjs report`.

### If your organization disables hooks (or Preview features)

VS Code hooks are Preview, and enterprise policy can disable them. Everything except automatic enforcement still works: the instructions and skills make the agent route commands through `tk run`, use the repo map, read ranges and answer tersely. You lose only the safety net for when it forgets. `tk report` then shows `tk run` savings only, since tool sizes are logged by the hook. Hook commands are written to **fail open**: if `node` or `.tokenkit/` is missing they exit 0 silently, so nothing gets blocked.

## Everyday commands

```text
node .tokenkit/tk.mjs run -- npm test        compressed run (the full log stays in .tokenkit/logs/last.log)
<cmd> 2>&1 | node .tokenkit/tk.mjs filter    compress any piped output
node .tokenkit/tk.mjs map                    rebuild the repo map
node .tokenkit/tk.mjs spec "fix @src/cart.js#applyDiscount pct is a percent +test >diff"
node .tokenkit/tk.mjs locate --why "the discount is applied twice"   preview the prompt hook's hint
node .tokenkit/tk.mjs budget [--ci]          audit always-on context (CI: exit 1 when over budget)
node .tokenkit/tk.mjs report [--days 7]      what the hooks saved, biggest tool outputs
```

## Configuration: `.tokenkit/config.json` (optional; every key optional)

```json
{
  "guard": { "commands": "auto", "reads": "deny", "bounded": "deny", "shell": "auto",
             "maxReadKB": 48, "allowPaths": ["^docs/generated/"] },
  "run":   { "maxLines": 80, "tailLines": 20, "noise": ["^Some noisy banner"], "errors": ["^MYAPP-E\\d+"] },
  "post":  { "minTokens": 1500 },
  "map":   { "maxTokens": 4000, "exclude": ["^legacy/"] },
  "budget": { "alwaysOnTokens": 1200 }
}
```

- `guard.commands`: `auto` means deny-with-command in VS Code and rewrite in the CLI. The other values are `rewrite`, `deny` and `off`.
- `guard.shell`: `auto` assumes PowerShell on Windows. Set `bash` if your VS Code integrated terminal is Git Bash.

## Design notes and limits

- **Never auto-approves.** The guard only denies, or rewrites without a permission decision, so your normal approval flow always applies.
- **Fail-open.** Hooks exit 0 and swallow their own errors. One command string (`node -e "import('./.tokenkit/hooks/x.mjs').catch(()=>0)"`) was tested under cmd, PowerShell, bash and sh, and it exits 0 silently when the runtime is missing.
- **Not wrapped:** long-running commands (`--watch`, `dev`, `serve`, `start`, background terminals) and anything already piped or redirected.
- **Nothing is lost.** Every compressed output keeps its full original in `.tokenkit/logs/`, and the model is told to grep it, not read it whole.
- **Non-terminal tools in VS Code.** Tasks (`execute/createAndRunTask`), `execute/testFailure` and MCP tools don't go through the terminal. Their output can't be compressed in VS Code; it is only logged. The `lean-verify` skill steers the agent to terminal runs through `tk`.
- **Estimates.** Token counts are a dependency-free heuristic (±20%). The repo map uses regex extraction (TS/JS, Python, Go, C#, Java/Kotlin, Rust, PHP, Ruby), not a parser.
- **Preview surfaces.** VS Code hooks are Preview and field names may change. `src/lib/hookio.mjs` is the one place that knows both payload dialects (VS Code snake_case, CLI camelCase).

Habits that matter as much as tooling (model choice, prompt cache, session hygiene) are in **[docs/PLAYBOOK.md](docs/PLAYBOOK.md)**.

## Layout

```
src/                 runtime, vendored into <repo>/.tokenkit/
  tk.mjs             CLI
  hooks/             guard.mjs (pre), post.mjs (post), session.mjs (start)
  lib/               compress, repomap, spec (TaskSpec), budget, report, rules, install, hookio
templates/           files installed into each repo (.github/…, .vscode/settings.json)
docs/                INSTALL.md (step by step), COMPARE.md (measure with/without), GUIDE.md (how it works + how to use), PLAYBOOK.md (habits), TASKSPEC.md
test/                node --test suites (npm test)
```
