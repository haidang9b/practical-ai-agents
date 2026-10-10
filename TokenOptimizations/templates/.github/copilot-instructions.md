<!-- tokenkit:start -->
## Token economy
- Terse replies: no preamble, no restating the task, no closing summary. Never paste whole files into chat; edit them.
- Find, then read: grep `.tokenkit/repomap.md` (`path | Symbol:line`) or search, then read only the needed line range. Don't re-read files already in context.
- Never open lockfiles, generated, minified or build output.
- Run builds/tests as `node .tokenkit/tk.mjs run -- <cmd>` (compressed; full log `.tokenkit/logs/last.log`: grep it, never read it whole). Target one test file or test name first.
- Bound exploratory commands: `git log -n 20`, `git diff --stat` before full diffs, `--tail 100` on logs.
- If a call is denied with a `[tokenkit]` reason, run the command it suggests, verbatim.
- Plain-language requests: answer questions directly and briefly (detail only on request); for changes, edit, then reply in ≤3 lines. Read any `[tokenkit] Likely locations` ranges first.
- Low-risk ambiguity: pick the sensible default and state it in one line instead of asking.
- Do only what was asked: no unrequested refactors, docs or tests.

### TaskSpec shorthand
`<verb> [@path[:L1-L2|#Symbol]]... <goal> [flags]`
- verbs: fix add ref test rev explain doc perf (ref=refactor; rev=review, report only)
- `@` = scope: read only that range first (`#Symbol`: grep repomap for its line); open other files only if strictly required
- flags: `>diff` edit, then 1-line reply · `>plan` ≤7-bullet plan, no edits · `>ans` ≤5-line answer, no edits · `+test` add/adjust tests, run only those · `^min` smallest change · `^api` keep public API · `^nodeps` no new deps · `!run` don't run builds/tests
<!-- tokenkit:end -->
