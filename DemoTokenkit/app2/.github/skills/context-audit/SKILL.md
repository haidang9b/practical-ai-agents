---
name: context-audit
description: Audit and shrink this repo's Copilot setup (instructions, skills, agents, MCP tools, noisy commands) to cut token and AI-credit usage. Use when asked to reduce Copilot cost or tokens, or to clean up custom instructions.
---
# Context audit

1. Run `node .tokenkit/tk.mjs budget` and `node .tokenkit/tk.mjs report`.
2. Fix in this order (largest savings first):
   1. **Noisy tool output**: for each command under "Largest single outputs", add a quiet flag or a narrower target to `lean-verify`, or add a regex to `guard`/`run` in `.tokenkit/config.json`.
   2. **Always-on instructions over budget**: move language- or framework-specific rules into `.github/instructions/<topic>.instructions.md` with a narrow `applyTo`. Move procedures and long examples into a skill.
   3. **Duplicates** across AGENTS.md, CLAUDE.md and copilot-instructions.md: keep one file and turn the others into one-line pointers.
   4. **Skill descriptions** over 300 chars: trim to one sentence saying when to use the skill.
   5. **Agents or prompts without `tools:`**: add the minimal list (`read`, `search`, `edit`, `execute`).
3. Rewrite rules as terse imperative bullets. Delete filler ("please", "make sure to", "it's important that") and any rule the model already follows by default.
4. Re-run `tk budget` and report always-on tokens before and after in one line.
