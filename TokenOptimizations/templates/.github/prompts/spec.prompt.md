---
description: Run a TaskSpec one-liner (e.g. fix @src/auth.ts#login null user +test >diff)
agent: lean
argument-hint: <verb> @path[:L1-L2|#Symbol] <goal> [>diff >plan >ans +test ^min ^api ^nodeps !run]
---
The request below is TaskSpec shorthand. Resolve any `#Symbol` scope by grepping `.tokenkit/repomap.md`, read only the scoped range, and honor every flag literally.

`<verb> [@path[:L1-L2|#Symbol]]... <goal> [flags]`
- verbs: fix add ref test rev explain doc perf (ref=refactor; rev=review, report only)
- `@` = scope: read only that range first (`#Symbol`: grep repomap for its line); open other files only if strictly required
- flags: `>diff` edit, then 1-line reply · `>plan` ≤7-bullet plan, no edits · `>ans` ≤5-line answer, no edits · `+test` add/adjust tests, run only those · `^min` smallest change · `^api` keep public API · `^nodeps` no new deps · `!run` don't run builds/tests
