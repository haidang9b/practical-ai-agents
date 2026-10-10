# Comparing with and without tokenkit, fairly

A first comparison on two copies of a small React + Vite task app (`app1` without, `app2` with tokenkit) came out "about the same". That's what this page is built on, so here is what that data showed first.

## What the first comparison actually showed

VS Code records how each prompt is made up. In both apps it looked like this at the start of a request:

| Part of every request | app1 (without) | app2 (with) | Can tokenkit change it? |
|---|---|---|---|
| Copilot's system instructions | 38% | 42% | No (tokenkit adds ~720 tokens to it) |
| **Tool definitions** (schemas of all enabled tools) | **50%** | **47%** | **Yes, with the `lean` agent.** Not in default Agent mode. |
| Your messages | 4% | 6% | Slightly (TaskSpec, terse replies) |
| Tool results | 8% | 5% | Yes: compression, read guard, bounded commands |

At a ~27k-token request, that is about 24k tokens of fixed Copilot overhead on **every** model call, identical in both apps. tokenkit's hooks act on the tool-results slice. Over a long turn that slice grew to 22% (`app2`'s last request).

Three more things made the two runs incomparable:
1. **Different work.** app1 had 2 turns and 115 tool calls; app2 had 3 turns and 156 tool calls. The same model rarely takes the same path twice.
2. **Most expensive output was the browser.** The agent tested the UI in the built-in browser: 23 browser calls in app1, 39 in app2. Page snapshots are large, and VS Code doesn't let hooks shrink a tool's output after it runs.
3. **A tokenkit bug, now fixed.** The repo map had been built when `app2` was still empty and wasn't refreshed for an hour, so plain-language hints never fired (0 of 3 prompts). Since this fix, the map rebuilds whenever source files change.

## Where the real savings are

| Lever | What it cuts | Where to see it in `tk usage` |
|---|---|---|
| **`lean` agent** (pick it in the chat mode picker) | Tool definitions: drops browser, web, subagent and MCP tools from every request | `ToolDefs` % lower; fewer `browser` calls |
| Hooks (automatic) | Test, build, install and lint output; lockfile and huge reads; unbounded `git log` and listings | `ToolResults` % lower; smaller "largest context" |
| Fresh chat per task + `/handoff` | The whole growing history | Smaller "largest context" |
| Pinned cheaper model for routine work | Price per token (10× or more) | `credits` |

---

## The protocol

### 1. Make two identical copies

Both must start from the same files. For example:

```powershell
$src = "D:\Learning\practical-ai-agents\DemoTokenkit\app1"   # your clean app
$base = "D:\Learning\practical-ai-agents\Compare"
robocopy $src "$base\without" /E /XD node_modules .tokenkit dist /NFL /NDL /NJH /NJS
robocopy $src "$base\with"    /E /XD node_modules .tokenkit dist /NFL /NDL /NJH /NJS
cd "$base\without"; npm install; git init -q; git add -A; git commit -qm base
cd "$base\with";    npm install; git init -q; git add -A; git commit -qm base
node D:\Learning\practical-ai-agents\TokenOptimizations\src\tk.mjs install "$base\with"
cd "$base\with"; node .tokenkit/tk.mjs doctor; git add -A; git commit -qm "add tokenkit"
```

`git init` gives each copy its own history, so nothing leaks between them, and lets you reset after each run:

```powershell
git reset --hard; git clean -fd     # in that copy only: undo the agent's changes
```

### 2. Keep everything else equal

- **Same model in both, chosen explicitly.** Auto can route to different models.
- **Same mode:** first compare *Agent* vs *Agent* (the hooks alone), then *Agent* vs *lean* (the full toolkit).
- **Fresh chat per prompt**, with all editor tabs closed (open files are attached to the prompt).
- **Each prompt twice per copy.** Compare averages; one run is noise.
- Plant the same bug before prompts P1 and P2 (below) in both copies, using the same edit.

### 3. Measure

After each run:

```powershell
node D:\Learning\practical-ai-agents\TokenOptimizations\src\tk.mjs usage "D:\Learning\practical-ai-agents\Compare\without"
node D:\Learning\practical-ai-agents\TokenOptimizations\src\tk.mjs usage "D:\Learning\practical-ai-agents\Compare\with"
```

`tk usage` reads VS Code's own records for that folder, so it works on the copy without tokenkit too. In the chat view, the context meter in the input box (or **Chat: Show Context Window Usage**) shows the same *Context Window* and *Session Cost*.

| Number | Trust it for |
|---|---|
| `tool calls` (and by type) | How much work and exploration the agent did |
| `largest context` | How much was carried along; this drives cost in long turns |
| `prompt share` | Where the tokens went (System / ToolDefs / Messages / ToolResults) |
| `credits` | Real cost, but VS Code records it on only some steps, so use it as a rough check |

In the copy **with** tokenkit, `node .tokenkit/tk.mjs report` also shows what the hooks did: runs compressed, reads blocked and hints given.

---

## Token-heavy prompts

Each prompt targets one cost driver. Plain language on purpose: this is how people really type.

| # | Prompt | What makes it expensive | What tokenkit should change |
|---|---|---|---|
| P1 | `Run all the tests and fix whatever is failing.` *(plant a bug first that breaks a few tests)* | Full test-suite output, repeated after each fix attempt | Each run compressed to failures + summary; narrower re-runs; fix loop capped at 3 |
| P2 | `Run the production build and fix every TypeScript error.` *(plant 2 type errors)* | Build and type-check output | Build output compressed; errors kept |
| P3 | `How does saving and loading tasks work? Walk me through the code.` | Searching, listing and reading many files to find the flow | A "likely locations" hint up front; ranged reads; short answer |
| P4 | `Summarize what changed recently from the git history, and which files change most often.` | Unbounded `git log`, big diffs | `git log` must be bounded (`-n 20`); large diffs start with `--stat` |
| P5 | `Upgrade all dependencies to their latest versions and make sure everything still passes.` | Install output, lockfile reads, repeated test and build runs | Install output compressed; lockfile reads blocked |
| P6 | `Start the app and check in the browser that I can add, complete and delete a task.` | Browser page snapshots (the biggest item in the first comparison) | **Agent mode: nothing** (VS Code can't shrink browser output). **lean agent:** no browser tools, so the agent verifies with tests instead. |
| P7 | P3, then P1, then P2 **in one chat** | The history keeps growing; everything is re-sent each step | Smaller tool results compound over the session |

**Reading the results honestly:**
- Expect the clearest differences in **P1, P2, P5 and P7** (heavy terminal output), and in any prompt when you use the **lean agent** (tool definitions).
- Expect little or no difference in **P6 in Agent mode**.
- If `tk report` in the "with" copy shows `0 got location hints` or no compressed runs, the hooks didn't act; run `node .tokenkit/tk.mjs doctor` there.

## Recording sheet

| Prompt | Mode | Run | Without: tool calls | Without: largest context | Without: credits | With: tool calls | With: largest context | With: credits | With: `tk report` notes |
|---|---|---|---|---|---|---|---|---|---|
| P1 | Agent | 1 | | | | | | | |
| P1 | Agent | 2 | | | | | | | |
| P1 | lean | 1 | | | | | | | |
| … | | | | | | | | | |
