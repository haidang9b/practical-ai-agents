---
description: Run a TaskSpec one-liner (e.g. fix @src/auth.ts#login null user +test >diff)
agent: lean
argument-hint: <verb> @path[:L1-L2|#Symbol] <goal> [>diff >plan >ans +test ^min ^api ^nodeps !run]
---
The request below is TaskSpec shorthand (legend in the repo instructions). Resolve any `#Symbol` scope by grepping `.tokenkit/repomap.md`, read only the scoped range, and honor every flag literally.
