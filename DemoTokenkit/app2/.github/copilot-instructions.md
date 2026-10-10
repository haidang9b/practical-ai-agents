<!-- tokenkit:start -->
## Token economy
- Every tool call re-sends the whole chat, so steps cost most. Plan, then batch; no repeated or exploratory calls.
- Locate before reading: read any `[tokenkit] Likely locations` ranges, or grep `.tokenkit/repomap.md` (`path | Symbol:line`); then read only those lines.
- Verify once, at the end: `node .tokenkit/tk.mjs verify` (typecheck, lint, tests in one call). Other commands: `node .tokenkit/tk.mjs run -- <cmd>`.
- Don't start dev servers or browsers to check work unless asked.
- Skip lockfiles and generated/build output. Bound commands (`git log -n 20`). Follow `[tokenkit]` hook messages verbatim.
- Terse replies; never paste whole files. Do only what was asked; choose sensible defaults instead of asking.
<!-- tokenkit:end -->
