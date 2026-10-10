import { findSymbol } from './repomap.mjs';

// TaskSpec: a one-line task notation that front-loads the facts an agent would
// otherwise spend tool calls (and clarifying turns) discovering.
//   <verb> [@path[:L1-L2|#Symbol]]... <goal text> [flags]

export const VERBS = {
  fix: 'Fix',
  add: 'Implement',
  ref: 'Refactor without changing behavior',
  test: 'Write or repair tests for',
  rev: 'Review and list concrete issues (no edits)',
  explain: 'Explain',
  doc: 'Write or update docs for',
  perf: 'Improve performance of'
};
const VERB_ALIASES = { refactor: 'ref', review: 'rev' };

// [legend wording, full expansion]
const FLAG_DEFS = {
  '>diff': ['edit, then 1-line reply', 'Output: make the edits, then reply with one line naming the changed files. No explanation.'],
  '>plan': ['≤7-bullet plan, no edits', 'Output: a plan of at most 7 bullets. Do not edit files.'],
  '>ans': ['≤5-line answer, no edits', 'Output: answer in at most 5 lines. Do not edit files.'],
  '+test': ['add/adjust tests, run only those', 'Add or update tests that cover the change; run only those tests.'],
  '^min': ['smallest change', 'Make the smallest change that works; no unrelated edits or cleanup.'],
  '^api': ['keep public API', 'Keep public APIs and signatures unchanged.'],
  '^nodeps': ['no new deps', 'Do not add dependencies.'],
  '!run': ['don\'t run builds/tests', 'Do not run builds or tests.']
};
export const FLAGS = Object.fromEntries(Object.entries(FLAG_DEFS).map(([k, [, text]]) => [k, text]));

// Single source for the legend embedded in copilot-instructions.md.
export const LEGEND = [
  '`<verb> [@path[:L1-L2|#Symbol]]... <goal> [flags]`',
  `- verbs: ${Object.keys(VERBS).join(' ')} (ref=refactor; rev=review, report only)`,
  '- `@` = scope: read only that range first (`#Symbol`: grep repomap for its line); open other files only if strictly required',
  `- flags: ${Object.entries(FLAG_DEFS).map(([k, [short]]) => `\`${k}\` ${short}`).join(' · ')}`
].join('\n');

function tokenize(s) {
  const out = [];
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function parseSpec(input) {
  const toks = tokenize(input.trim());
  const spec = { verb: null, scopes: [], goal: [], flags: [], unknown: [] };
  if (toks.length) {
    const v = VERB_ALIASES[toks[0].toLowerCase()] ?? toks[0].toLowerCase();
    if (VERBS[v]) { spec.verb = v; toks.shift(); }
  }
  for (const t of toks) {
    if (t.startsWith('@') && t.length > 1) {
      const m = /^@([^:#]+)(?::(\d+)(?:-(\d+))?|#([\w$.]+))?$/.exec(t);
      if (m) spec.scopes.push({ path: m[1], start: m[2] && +m[2], end: m[3] ? +m[3] : m[2] && +m[2], symbol: m[4] });
      else spec.unknown.push(t);
    } else if (FLAGS[t]) {
      spec.flags.push(t);
    } else if (/^[>+^!][a-z]+$/.test(t)) {
      spec.unknown.push(t);
    } else {
      spec.goal.push(t);
    }
  }
  spec.goal = spec.goal.join(' ');
  return spec;
}

export function expandSpec(input, root = process.cwd()) {
  const spec = parseSpec(input);
  const lines = [];
  const goal = spec.goal || '(see scope)';
  lines.push(spec.verb ? `Task: ${VERBS[spec.verb]}: ${goal}` : `Task: ${goal}`);

  if (spec.scopes.length) {
    const parts = spec.scopes.map((s) => {
      if (s.symbol) {
        const r = findSymbol(root, s.path, s.symbol);
        return r ? `${s.path} lines ${r.start}-${r.end} (${s.symbol})` : `${s.path} (symbol ${s.symbol})`;
      }
      if (s.start) return `${s.path} lines ${s.start}-${s.end}`;
      return s.path;
    });
    lines.push(`Scope: ${parts.join('; ')}. Read only these ranges first; open other files only if strictly required.`);
  }
  const constraints = spec.flags.filter((f) => !f.startsWith('>')).map((f) => FLAGS[f]);
  if (constraints.length) lines.push(`Constraints: ${constraints.join(' ')}`);
  const out = spec.flags.find((f) => f.startsWith('>'));
  if (out) lines.push(FLAGS[out]);
  else if (spec.verb === 'rev' || spec.verb === 'explain') lines.push('Output: concise bullets; no code unless essential.');
  return { text: lines.join('\n'), spec };
}
