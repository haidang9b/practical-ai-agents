---
name: lean-verify
description: Run builds, tests, linters or type-checks with the fewest calls and smallest output. Use before running any check, and when fixing a failing test.
---
# Lean verification

Each command is one more model call that re-sends the whole conversation. Fewer calls save more than shorter output.

- **Finish with one call:** `node .tokenkit/tk.mjs verify` runs typecheck, lint and tests together and prints only what failed. Add `--build` when the build matters. Don't run typecheck, lint and tests as separate calls.
- **While fixing one failing test**, re-run just that test, once per fix attempt: `node .tokenkit/tk.mjs run -- npx vitest run path/x.test.ts` (`pytest path::name -q`, `go test ./pkg -run Name`, `dotnet test --filter Name`).
- **At most 3 fix attempts** on the same failure. Then stop and report the failing assertion (one line), the suspected cause, and what you tried.
- **Need more detail?** Grep the log file named in the `[tk]` header. Never read it whole.
- **Don't** start dev servers, open browsers, or poll ports to check work unless the user asked. Tests and typecheck are the evidence.
- **Use the terminal** for builds and tests, not task-creation tools, unless the user asked for a task.
