---
name: lean-verify
description: Run builds, tests, linters or type-checks with minimal output. Use before executing any command that may print a lot, and when iterating on a failing test.
---
# Lean verification

- Use the terminal, not task-creation tools, for builds and tests, unless the user asked for a task.
- Run through the compressor: `node .tokenkit/tk.mjs run -- <command>`. It prints the status, the first lines, errors with context, and the summary. The full log is `.tokenkit/logs/last.log`.
- Need more detail? Grep `.tokenkit/logs/last.log` for the test name or error text. Never read it whole.
- One command per terminal call: `cd` in its own call rather than chained with `&&` or `;`, so the command wraps cleanly. If a `[tokenkit]` hook denies a call, run the command it suggests, verbatim.
- Start with the narrowest target:

| runner | one file / one test |
|---|---|
| vitest / jest | `npx vitest run path/x.test.ts -t "name"` / `npx jest path/x.test.ts -t "name"` |
| pytest | `pytest path/test_x.py::test_name -q` |
| go | `go test ./pkg/x -run TestName` |
| dotnet | `dotnet test --filter "FullyQualifiedName~Name" -v q` |
| cargo | `cargo test -q name` |
| maven / gradle | `mvn -q test -Dtest=Class#method` / `gradle test --tests Class.method -q` |

- Prefer quiet reporters: `-q`, `--silent`, `--reporter=dot`, `--no-progress`, `-v q`.
- Fix loop budget: at most 3 fix-and-rerun cycles on the same failure. Then stop and report the failing assertion (one line), the suspected cause, and what you tried.
- Run the broad suite once at the end, not after every edit.
