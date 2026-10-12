---
name: lean-explore
description: Find code in this repo with the fewest tool calls and smallest reads. Use when you need to locate where something is defined or implemented, or before editing an unfamiliar area.
---
# Lean exploration

Goal: reach the exact lines to change in ≤3 tool calls, without loading irrelevant files.

1. **Symbol name known**: grep `.tokenkit/repomap.md` for it. Each line is `path | Name:line .method:line`. Read from that line to the next listed symbol.
2. **Behavior known, symbol unknown**: text-search the most specific literal you have (error message, route, config key, CSS class, log text), scoped to source directories. Use the top hits only.
3. **Area unknown**: grep `.tokenkit/repomap.md` for directory or file-name fragments. In a large repo, read `.tokenkit/areas.md` first (folders with file counts; the map's header says when it exists). Never list directories recursively.
4. **Read ranges, not files**: 60–150 lines around the target. Widen only if the code you need is cut off.
5. **Stop** once you can name the exact lines to change. Don't open callers or tests "for context" unless the change alters their contract.

If a symbol isn't where the map says, the map is stale: run `node .tokenkit/tk.mjs map` once.

Avoid: broad semantic search for things grep can find, reading lockfiles or generated or build output, re-reading a file already in context, and opening a whole file to find one function.
