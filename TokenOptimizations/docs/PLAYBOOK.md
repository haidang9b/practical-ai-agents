# Playbook: spending fewer AI credits without slowing down

Since June 1, 2026 Copilot bills **tokens × per-model price**: input, cached input (about 10% of the input price) and output (5–8× the input price). Premium-request multipliers no longer apply, except on annual plans until they renew. The levers below are ranked by typical impact. tokenkit automates #4 and supports #3, #5 and #6. The rest are habits.

> Prices quoted are GitHub's list rates per 1M tokens at the time of writing ([source](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)). Check the page for your models.

## 1. Pick the model per task (biggest multiplier)

| Model (example) | input | cached | output |
|---|---|---|---|
| Claude Sonnet 4.6 | $3.00 | $0.30 | $15.00 |
| GPT-5 mini | $0.25 | $0.025 | $2.00 |

That's 12× cheaper on input and 7.5× on output for the same tokens.
- Default to **Auto** model selection, which takes 10% off on paid plans.
- Use a small model for mechanical work: renames, boilerplate, test scaffolds, docstrings, "where is X", regex, quick explanations. `/q` is pinned to GPT-5 mini with no tools. Pin the `lean` agent's `model:` for routine fixes.
- Save frontier models for genuinely hard reasoning: design, tricky bugs, cross-cutting refactors.
- Lower reasoning effort for routine tasks. Reasoning tokens bill as output.

## 2. Keep the prompt cache warm

Cached input costs about 10%, but the cache breaks when you **change model, reasoning effort, context size, or enabled tools or MCP servers mid-session**. It also expires after about 1 hour (24h for OpenAI models).
- Choose model and tools *before* the first message. Need a different model? Start a new session with `/handoff`.
- Don't toggle MCP servers or tools mid-task.
- Avoid hooks or instructions that inject changing content (timestamps, `git status`). tokenkit's session hook injects nothing for this reason.

## 3. One task per session; hand off instead of dragging on

Every step re-sends the whole history. Step 40 of a sprawling session is far more expensive than step 3 of a fresh one.
- Finish a task, then start a new chat.
- For multi-part work, run `/handoff` (writes a 25-line `.tokenkit/handoff.md`), then open a new chat with `#file:.tokenkit/handoff.md continue`.
- In a long session that must continue, use `/compact [focus]` (VS Code) or let Copilot CLI auto-compact. `/context` in the CLI shows where tokens go.

## 4. Keep tool output out of the context (tokenkit does this)

Illustrative cost at Sonnet 4.6 rates: one 10k-token test log entering at step 5 of a 30-step session costs about 10k × $3.75/M (cache write) plus 25 × 10k × $0.30/M (re-reads), **about 11 credits**. Five test runs make about 55 credits, against a Pro allowance of 1,000 base credits a month. Compressed to about 300 tokens, the same five runs cost **under 2 credits**.
- Let the guard wrap test, build and install commands, or call `node .tokenkit/tk.mjs run -- …` yourself.
- Run the narrowest target (one test file or test name), and the full suite once at the end.
- Bounded commands only: `git log -n 20`, `git diff --stat` first, `--tail 100`.

## 5. Scope precisely; skip exploration and clarifying turns

- Plain language works: the prompt hook matches your words to the repo map and hands the agent likely locations. Help it by naming what you know: a function in backticks, a file name, or the domain words used in the code.
- For exact control, give the location: `@src/auth/login.ts#validateUser` or `@path:40-90` ([TaskSpec](TASKSPEC.md)). Each avoided search, list or read call saves a full context re-send.
- Prefer attaching a **selection** over `#file` (which inlines the whole file), and over `#codebase` when you already know where to look.
- State the done-criteria up front (`+test`, `^api`, `^min`) so the agent doesn't ask.
- Let the agent grep `.tokenkit/repomap.md` instead of listing directories.

## 6. Shape the answer (output is the most expensive token)

- `>diff`: edit, then a one-line reply. `>ans`: at most 5 lines. `>plan`: at most 7 bullets, no edits.
- Never ask for "the full updated file". A 400-line rewrite is about 4k output tokens (~6 credits at $15/M), while the equivalent 20-line edit is about 0.3 credits.
- The instructions block already forbids preambles, recaps and closing summaries.

## 7. Trim always-on context and tool schemas

- Tool definitions are input on every call; a few dozen can cost 10–20k tokens. Give each custom agent a minimal `tools:` list, and disable MCP servers you aren't using *before* starting a session.
- Keep one instructions file (`copilot-instructions.md`, `AGENTS.md` and `CLAUDE.md` are all loaded if present). Move language-specific rules into `.github/instructions/*.instructions.md` with a narrow `applyTo`, and procedures into skills.
- Run `node .tokenkit/tk.mjs budget` (or `/audit`). Add `budget --ci` to CI to keep it from regrowing.

## 8. Use the free features

Completions and Next Edit Suggestions cost no credits. For a small change you can describe in a comment, type it and let NES finish, rather than opening chat.

## 9. Guardrails

- Set a monthly budget in your GitHub billing settings.
- Copilot CLI: cap sessions with `--max-ai-credits` or `/limits` (CLI 1.0.66+).
- The `lean-verify` skill caps fix-and-rerun loops at 3 attempts. Runaway loops are the most common source of surprise spend.

## Daily checklist

1. Fresh chat per task, with model chosen up front (Auto, or small for routine work).
2. TaskSpec one-liner with scope and output flag.
3. Let tokenkit handle commands. Glance at `tk report` weekly.
4. `/handoff` before switching models or when the thread gets long.
