---
name: handoff
description: Write a compact handoff note so work continues in a fresh, cheap session. Use when the user says handoff, checkpoint, wrap up or new chat, or when the conversation has grown long.
---
# Handoff

Every request re-sends the whole conversation. A fresh session that starts from a 25-line note costs a fraction of continuing a long one.

Overwrite `.tokenkit/handoff.md` with at most 25 lines:

```
# Handoff: <task in ≤10 words>
Goal: <one line>
Done: <bullets with path:line refs>
Next: <ordered bullets; the first must be immediately actionable>
Files: <path:range, and why> (only what the next step needs)
Decisions: <choices and constraints that must not be revisited>
Verify: <exact command, e.g. node .tokenkit/tk.mjs run -- pytest tests/test_x.py -q>
Blockers: <only if any>
```

Rules: facts only, no narrative. Reference code by `path:line` and never paste it. Leave out anything `git diff` already shows.

Then reply with exactly one line: `New chat → #file:.tokenkit/handoff.md continue`
