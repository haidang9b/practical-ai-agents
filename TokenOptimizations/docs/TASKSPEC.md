# TaskSpec: a one-line task notation

The prompt you type is rarely what costs money. What costs money is what the agent does because the prompt was vague: search calls to find the code, reading whole files, a clarifying question (a full extra round-trip), a long explanation you didn't need. TaskSpec puts *scope*, *constraints* and *answer shape* in one line, and the agent acts on all three from its first step.

```
<verb> [@path[:L1-L2|#Symbol]]... <goal> [flags]
```

Copilot learns the notation from a ~150-token legend inside the tokenkit block of `.github/copilot-instructions.md`, so you can type it straight into chat. The prompt hook also expands it before the agent starts, resolving `#Symbol` to exact lines.

**TaskSpec is optional.** Plain-language requests get location hints from the same repo map automatically (see [GUIDE.md section 4.7](GUIDE.md#47-the-prompt-hook-plain-language-requests)). Use TaskSpec when you want exact scope, constraints or answer shape.

## Verbs

| verb | meaning |
|---|---|
| `fix` | fix a bug |
| `add` | implement something new |
| `ref` | refactor without behavior change |
| `test` | write or repair tests |
| `rev` | review and list concrete issues (no edits) |
| `explain` | explain |
| `doc` | write or update docs |
| `perf` | improve performance |

## Scope (`@`)

| form | meaning |
|---|---|
| `@src/cart.js` | start in this file |
| `@src/cart.js:40-90` | read only these lines first |
| `@src/cart.js#applyDiscount` | resolve the symbol through `.tokenkit/repomap.md` and read just its range |

The agent reads the scoped range first and opens other files only when strictly required. Several scopes are allowed.

Prefer `@path` over VS Code's `#file:` for large files: `#file` inlines the whole file into the prompt, while `@path:range` lets the agent read only the part it needs.

## Flags

| flag | effect |
|---|---|
| `>diff` | make the edits, then reply with one line naming the changed files |
| `>plan` | at most 7 bullets, no edits |
| `>ans` | answer in at most 5 lines, no edits |
| `+test` | add or update tests for the change, and run only those |
| `^min` | smallest change that works; no unrelated cleanup |
| `^api` | keep public APIs and signatures unchanged |
| `^nodeps` | no new dependencies |
| `!run` | don't run builds or tests |

## Examples

```text
fix @src/cart.js#applyDiscount pct is a percentage, not a fraction +test >diff
rev @src/api/orders.ts:40-120 >ans
add @src/routes/users.ts rate-limit POST /login to 10/min per IP ^nodeps +test
ref @lib/parser.py#tokenize split into smaller functions ^api ^min !run
explain @internal/cache/lru.go#Evict >ans
test @src/utils/date.ts#parseRange DST and leap-year edge cases >diff
```

## Tooling

- `/spec <taskspec>` (VS Code prompt file) runs it in the `lean` agent.
- `node .tokenkit/tk.mjs spec "<taskspec>"` previews the expansion and resolves `#Symbol` to exact lines. Use it to check a spec or to feed Copilot CLI:

```text
$ node .tokenkit/tk.mjs spec "fix @src/cart.js#applyDiscount pct is a percentage +test >diff"
Task: Fix: pct is a percentage
Scope: src/cart.js lines 6-7 (applyDiscount). Read only these ranges first; open other files only if strictly required.
Constraints: Add or update tests that cover the change; run only those tests.
Output: make the edits, then reply with one line naming the changed files. No explanation.
```

```powershell
copilot -p (node .tokenkit/tk.mjs spec "fix @src/cart.js#applyDiscount pct is a percentage +test >diff" | Out-String)
```

## Extending

Verbs and flags are defined once in `src/lib/spec.mjs` (`VERBS`, `FLAG_DEFS`). After changing them, regenerate the legend with `node src/tk.mjs spec --legend`, paste it into `templates/.github/copilot-instructions.md`, and re-run `install`. A test fails if the template and the code drift apart.
