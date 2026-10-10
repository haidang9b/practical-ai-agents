---
description: Checkpoint the current task into .tokenkit/handoff.md so the next chat starts small
agent: agent
tools: ['read', 'search', 'edit']
---
Every request re-sends the whole conversation; a fresh chat that starts from a short note costs a fraction of continuing this one.

Overwrite `.tokenkit/handoff.md` with at most 25 lines:

```
# Handoff: <task in ≤10 words>
Goal: <one line>
Done: <bullets with path:line refs>
Next: <ordered bullets; the first must be immediately actionable>
Files: <path:range, and why> (only what the next step needs)
Decisions: <choices and constraints that must not be revisited>
Verify: node .tokenkit/tk.mjs verify
Blockers: <only if any>
```

Facts only. Reference code by `path:line`, never paste it. Leave out anything `git diff` already shows.
Then reply with exactly one line: `New chat → #file:.tokenkit/handoff.md continue`
