# Installing tokenkit, step by step

About 10 minutes for your first repository, 1 minute for each one after. Commands are for **Windows PowerShell**; on macOS/Linux use the same commands with `/` paths.

Throughout this page:
- `$kit` is where the tokenkit folder lives. Set it once per terminal:
  ```powershell
  $kit = "D:\Learning\practical-ai-agents\TokenOptimizations"
  ```
- `D:\code\my-app` stands for **your** project. Replace it with your real path.

| Step | What you do | Time |
|---|---|---|
| [1](#step-1--check-the-prerequisites) | Check the prerequisites | 1 min |
| [2](#step-2--self-test-the-toolkit) | Self-test the toolkit | 1 min |
| [3](#step-3--preview-the-install-optional) | Preview the install (optional) | 1 min |
| [4](#step-4--install-into-your-project) | Install into your project | 1 min |
| [5](#step-5--run-the-health-check) | Run the health check | 1 min |
| [6](#step-6--review-and-commit) | Review and commit | 2 min |
| [7](#step-7--verify-inside-vs-code) | Verify inside VS Code | 3 min |
| [8](#step-8--optional-tuning) | Optional tuning | as needed |

The end of the page covers [more repositories](#installing-into-more-repositories), [updating](#updating), [turning it off](#turning-it-off-temporarily), [uninstalling](#uninstalling) and [troubleshooting](#troubleshooting).

---

## Step 1 — Check the prerequisites

| You need | Check with | If missing |
|---|---|---|
| VS Code with GitHub Copilot, signed in, agent mode available | Open the Chat view and look for the **Agent** mode picker | Install the GitHub Copilot extension and sign in |
| Node.js 18 or later | `node -v` → `v18…` or higher | `winget install OpenJS.NodeJS.LTS`, then **restart VS Code** so it sees the new PATH |
| Git (recommended) | `git --version` | `winget install Git.Git` |

Your organization must also allow Copilot **hooks** (a Preview feature). If you're not sure, continue anyway. If hooks turn out to be blocked, tokenkit still helps through its instructions and skills ([details](GUIDE.md#if-your-organization-disables-hooks)).

## Step 2 — Self-test the toolkit

tokenkit has no dependencies, so there is nothing to `npm install`. Run its own tests once to confirm it works on your machine:

```powershell
cd $kit
npm test
```

Expected (the count may be higher in newer versions):

```text
# pass 41
# fail 0
```

Keep the toolkit folder where it is. Your projects get their own copy, so this folder is only used when you install, upgrade or uninstall.

## Step 3 — Preview the install (optional)

See exactly what would change, without writing anything:

```powershell
node "$kit\src\tk.mjs" install D:\code\my-app --dry-run
```

The first line confirms it's a preview: `DRY RUN: nothing is written; this is what install would do.`

## Step 4 — Install into your project

```powershell
node "$kit\src\tk.mjs" install D:\code\my-app
```

Expected output for a project that had none of these files:

```text
== D:\code\my-app
runtime   .tokenkit/ (tk.mjs, lib/, hooks/)
created   .github/agents/lean.agent.md
created   .github/copilot-instructions.md
created   .github/hooks/tokenkit.json
created   .github/instructions/testing.instructions.md
created   .github/prompts/audit.prompt.md
created   .github/prompts/handoff.prompt.md
created   .github/prompts/q.prompt.md
created   .github/prompts/spec.prompt.md
created   .github/skills/lean-explore/SKILL.md
created   .github/skills/lean-verify/SKILL.md
created   .vscode/settings.json
updated   .gitignore (+.tokenkit/logs/, .tokenkit/repomap.md, .tokenkit/handoff.md)
map       .tokenkit/repomap.md (1 files, ~65 tokens, level 0)
```

What each word means:

| Word | Meaning |
|---|---|
| `created` | The file didn't exist; tokenkit added it |
| `merged` | You already had `.github/copilot-instructions.md`. tokenkit appended a block between `<!-- tokenkit:start -->` and `<!-- tokenkit:end -->`, and your text is untouched. |
| `skipped … (not created by tokenkit)` | You already have a file at that path. Yours is kept. |
| `unchanged` / `updated` | Seen when re-running install (see [Updating](#updating)) |

**If `.vscode/settings.json` was skipped** because you already have one, add these keys to it by hand:

```jsonc
"search.exclude": { "**/node_modules": true, "**/dist": true, "**/build": true, "**/coverage": true, "**/*.min.js": true, "**/package-lock.json": true },
"chat.tools.compressOutput.enabled": true,
"chat.useHooks": true,
"chat.useAgentSkills": true
```

## Step 5 — Run the health check

`doctor` checks the installation and actually runs every hook command, the same way VS Code will, with sample input:

```powershell
cd D:\code\my-app
node .tokenkit/tk.mjs doctor
```

Expected:

```text
tokenkit doctor: D:\code\my-app
  [ok]   Node v22.17.0 (needs 18 or later)
  [ok]   runtime .tokenkit/ present
  [ok]   hook file registers 4 events
  [ok]   guard hook runs and blocks a lockfile read
  [ok]   guard hook routes `npm test` through tk run
  [ok]   userPromptSubmitted hook runs (exit 0)
  [ok]   postToolUse hook runs (exit 0)
  [ok]   sessionStart hook runs (exit 0)
  [ok]   tokenkit block in .github/copilot-instructions.md
  [ok]   repo map present (1 source files)
  [ok]   .gitignore keeps .tokenkit/logs/ out of git
  [ok]   .tokenkit/ will be committed with the repo
  [ok]   always-on context ~324 tokens (budget 1200)

All local checks passed.
```

- `[FAIL]` lines say what is wrong and how to fix it, and the command exits with code 1.
- `[warn]` lines are advice; tokenkit still works.

## Step 6 — Review and commit

```powershell
git status --short
```

You should see `.github/`, `.tokenkit/`, `.gitignore`, and `.vscode/` (if it was created). Logs, the repo map and handoff notes are already ignored.

```powershell
git add .github .tokenkit .gitignore .vscode
git commit -m "Add tokenkit (Copilot token savings)"
```

**Why commit `.tokenkit/`:** teammates who pull the repo get the same setup with no install of their own. The Copilot cloud agent also needs it, and only reads hooks from the default branch.

## Step 7 — Verify inside VS Code

1. **Open the project folder** in VS Code. If asked whether you trust the authors, choose **Yes, I trust the authors**. Hooks don't run in untrusted (Restricted Mode) workspaces.
2. **Reload:** Command Palette (`Ctrl+Shift+P`) → **Developer: Reload Window**.
3. **Check the hooks are loaded:** Command Palette → **Chat: Configure Hooks**. `.github/hooks/tokenkit.json` should be listed.
4. **Open Chat** (`Ctrl+Alt+I`) and switch the mode picker to **Agent**. You can also pick the **lean** agent here.
5. **Test the output compressor.** Type: `run the tests`.
   - The approval prompt shows a command like `node "D:/code/my-app/.tokenkit/tk.mjs" run --shell powershell -- npm test`. Approve it.
   - The result starts with `[tk] OK …` or `[tk] FAILED …` and ends with a short summary, not the full log.
6. **Test the guard.** Type: `show me the git log`. The unbounded `git log` is blocked, and the agent retries with a limit such as `git log -n 20`.
7. **Test plain-language hints.** Ask about something in your code by name, for example `the discount is applied wrong`. To see the exact note the hook added, run the same text in a terminal:
   ```powershell
   node .tokenkit/tk.mjs locate "the discount is applied wrong"
   ```
8. **If something didn't happen:** open **View → Output** and choose **GitHub Copilot Chat Hooks** in the dropdown. It shows each hook run and any error. Also see [Troubleshooting](#troubleshooting).

You're done. From now on, just work as usual. After a day or two, see what was saved:

```powershell
node .tokenkit/tk.mjs report
```

## Step 8 — Optional tuning

| If… | Do this |
|---|---|
| Your VS Code terminal is **Git Bash**, not PowerShell | Create `.tokenkit/config.json` with `{ "guard": { "shell": "bash" } }` |
| You're tired of approving wrapped test runs | Add the narrow auto-approve rule from [GUIDE section 8](GUIDE.md#optional-skip-approval-for-wrapped-test-and-build-runs) to your **user** settings |
| You want routine work on a cheaper model | In `.github/agents/lean.agent.md`, uncomment the `model:` line |
| `/q` can't find its model | Change `model:` in `.github/prompts/q.prompt.md` to a name from your model picker |
| A file you need is blocked | Add its path pattern to `guard.allowPaths` in `.tokenkit/config.json` |

All settings are listed in [GUIDE section 8](GUIDE.md#8-configuration-reference). Run `node .tokenkit/tk.mjs doctor` after changing anything.

---

## Installing into more repositories

Pass several paths at once:

```powershell
node "$kit\src\tk.mjs" install D:\code\repo-a D:\code\repo-b D:\code\repo-c
```

Then do steps 5 to 7 in each one.

## Updating

When you get a newer version of the tokenkit folder, re-run install on each repository:

```powershell
node "$kit\src\tk.mjs" install D:\code\my-app
```

- `updated` — a tokenkit file you never edited was upgraded.
- `retired` — a file an older version installed and this one no longer ships (removed only if you never edited it).
- `skipped … (edited locally …)` — you changed that file, so it is kept. Add `--force` to replace it.
- The runtime in `.tokenkit/` is always refreshed. Your `.tokenkit/config.json` is kept.

Run `doctor`, then commit.

## Turning it off temporarily

To pause everything without uninstalling, create or edit `.tokenkit/config.json`:

```json
{ "guard": { "commands": "off", "reads": "off", "bounded": "off" }, "prompt": { "hints": "off" } }
```

Delete the file (or those keys) to turn it back on. The instructions and skills stay active either way.

## Uninstalling

Preview first, then remove:

```powershell
node "$kit\src\tk.mjs" uninstall D:\code\my-app --dry-run
node "$kit\src\tk.mjs" uninstall D:\code\my-app
```

Expected:

```text
== D:\code\my-app
removed   .github/agents/lean.agent.md
removed   .github/copilot-instructions.md
removed   .github/hooks/tokenkit.json
...
removed   .vscode/settings.json
updated   .gitignore (tokenkit lines removed)
removed   .tokenkit/ (runtime, config, logs, repo map)
```

- Only files tokenkit created and nobody has edited since are removed. Edited ones are listed as `kept … (edited locally)`.
- If `copilot-instructions.md` holds your own rules too, only the tokenkit block is taken out (`unmerged`).
- Review with `git status`, then commit.

## Troubleshooting

| Problem | Fix |
|---|---|
| `node : The term 'node' is not recognized` | Install Node (step 1), then open a **new** terminal. In VS Code, restart the app. |
| `doctor` shows `[FAIL] guard hook did not block a lockfile read` | Re-run install; check that `node -v` works in a plain `cmd` window, because hooks may run through cmd |
| `doctor` shows `[FAIL] … chat.useHooks to false` | Remove that line from `.vscode/settings.json` (or set it to `true`) |
| **Chat: Configure Hooks** doesn't list `tokenkit.json` | Trust the workspace (step 7.1) and reload. If it's still missing, your organization may block hooks: tokenkit then works through instructions and skills only. |
| Tests run but output doesn't start with `[tk]` | Check the **GitHub Copilot Chat Hooks** output channel. Commands with pipes (`npm test \| tail`) or `--watch` are intentionally left alone. |
| `Cannot find module …\.tokenkit\tk.mjs` | The terminal is in a subfolder. Ask the agent to `cd` to the project root, or re-run; rewritten commands use an absolute path. |
| PowerShell errors on a rewritten command, but your terminal is bash | Set `"guard": { "shell": "bash" }` (step 8) |
| Something else | Look in `.tokenkit/logs/errors.jsonl` and `guard.jsonl`, and see [GUIDE section 9](GUIDE.md#9-troubleshooting) |

Next: read [GUIDE.md](GUIDE.md) to understand what each part does, and [PLAYBOOK.md](PLAYBOOK.md) for habits that save even more.
