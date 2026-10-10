---
description: Audit and shrink this repo's Copilot setup (instructions, skills, agents, MCP tools, noisy commands)
agent: agent
tools: ['read', 'search', 'edit', 'execute']
---
1. Run `node .tokenkit/tk.mjs budget` and `node .tokenkit/tk.mjs report`.
2. Fix in this order (largest savings first):
   1. **Steps**: repeated checks → use `node .tokenkit/tk.mjs verify` once; remove instructions that cause extra tool calls.
   2. **Noisy tool output**: for each command under "Largest single outputs", add a quiet flag or narrower target, or a `run.noise` regex in `.tokenkit/config.json`.
   3. **Always-on instructions over budget**: move language-specific rules to `.github/instructions/<topic>.instructions.md` with a narrow `applyTo`; move procedures to a skill or prompt file.
   4. **Duplicates** across AGENTS.md, CLAUDE.md and copilot-instructions.md: keep one, make the others one-line pointers.
   5. **Agents or prompts without `tools:`**: add the minimal list (`read`, `search`, `edit`, `execute`).
3. Rewrite rules as terse imperative bullets; delete filler and anything the model does by default.
4. Re-run `tk budget`; report always-on tokens before and after in one line.
