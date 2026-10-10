import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_DIR } from './config.mjs';
import { findSymbol } from './repomap.mjs';

// Turns a plain-language request into a few "start here" locations by matching
// its words against the repo map. Deterministic and offline: no model, no index
// service. Precision over recall: when nothing matches confidently, say nothing.

const STOP = new Set(`a an the and or but if then than so to of in on at by for with from into onto over under
about after before because while when where what which who whom whose why how is are was were be been being am do does
did done doing have has had having can could should would will shall may might must not no nor yes it its this that these
those there here their they them we us our you your i me my he she his her as also just only very more most less least
some any all each every both either neither same other such own again still even really please thanks thank make makes
made sure need needs want wants like look looks see show find get gets got set put use uses used using via per etc
fix fixes fixed fixing bug bugs issue issues problem problems error errors broken wrong right correct incorrect work
works working add adds added adding update updates updated change changes changed remove removes removed delete create
check run runs running test tests testing write read implement refactor review explain describe improve support handle
function functions method methods class classes file files code line lines value values return returns new old thing
things case cases way data type types name names call calls item items list page instead twice once always never
something anything everything nothing currently properly correctly happens happening seems doesn isn don didn
shouldn wouldn couldn won aren wasn weren hasn haven`
  .split(/\s+/).filter(Boolean));

// Path segments that say nothing about the feature.
const GENERIC_PATH = new Set(['src', 'lib', 'app', 'apps', 'pkg', 'internal', 'cmd', 'test', 'tests', 'spec', 'specs',
  '__tests__', 'index', 'main', 'mod', 'init', 'utils', 'util', 'common', 'core', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'cs', 'java', 'kt', 'rs', 'rb', 'php', 'vue', 'svelte']);

const splitWords = (s) => s
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .split(/[^A-Za-z]+/)
  .map((w) => w.toLowerCase())
  .filter((w) => w.length >= 3);

// Light suffix stemmer: "applied" = "apply", "validation" = "validator" = "validate",
// "compressor" = "compress", "orders" = "order"; but "repo" != "report", "readme" != "read".
const SUFFIXES = ['izations', 'ization', 'ations', 'ation', 'ators', 'ator', 'izing', 'izes', 'ized', 'ize',
  'ments', 'ment', 'ings', 'ing', 'ions', 'ion', 'ating', 'ates', 'ated', 'ate', 'ers', 'er', 'ors', 'or',
  'ies', 'ied', 'es', 'ed', 's'];
export function stem(word) {
  let w = word.toLowerCase();
  for (const suf of SUFFIXES) {
    if (!w.endsWith(suf) || w.length - suf.length < 3) continue;
    if (suf === 's' && /(ss|us|is)$/.test(w)) break;
    w = w.slice(0, -suf.length) + (suf === 'ies' || suf === 'ied' ? 'i' : '');
    break;
  }
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.endsWith('y')) w = `${w.slice(0, -1)}i`;
  if (w.length > 3 && /([bdfgklmnprtz])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}
export const wordsMatch = (a, b) => stem(a) === stem(b);

export function parseMap(text) {
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [path, rest] = line.split(' | ');
    if (/\/ \(\d+ files\)$/.test(path)) continue; // level-4 directory summary
    const syms = [];
    let owner = null;
    for (const tok of (rest || '').split(' ').filter(Boolean)) {
      const m = /^(\.)?(.+):(\d+)$/.exec(tok);
      if (!m) continue;
      const method = Boolean(m[1]);
      if (!method) owner = m[2];
      syms.push({ name: m[2], line: Number(m[3]), method, owner: method ? owner : null });
    }
    files.push({ path: path.trim(), syms });
  }
  return files;
}

export function extractCues(prompt) {
  const text = String(prompt);
  const idents = new Set();
  for (const [, w] of text.matchAll(/`([^`\s]+)`/g)) idents.add(w.replace(/\(\)$/, ''));
  for (const [w] of text.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
    const looksLikeCode = /[a-z][A-Z]|_|\./.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w);
    if (looksLikeCode) idents.add(w.replace(/\(\)$/, ''));
  }
  const paths = [...text.matchAll(/[\w./\\-]+\.[A-Za-z]{1,5}\b/g)].map((m) => m[0].replace(/\\/g, '/'))
    .filter((p) => /[/]|\.[a-z]{1,5}$/i.test(p) && !/^\d/.test(p));
  const seq = splitWords(text.replace(/`[^`]*`/g, ' '));
  const words = [...new Set(seq)].filter((w) => !STOP.has(w));
  const joined = [];
  for (let i = 0; i + 1 < seq.length; i++) {
    if (!STOP.has(seq[i]) && !STOP.has(seq[i + 1])) joined.push(seq[i] + seq[i + 1]);
  }
  return { idents: [...idents], paths, words, joined: [...new Set(joined)] };
}

export function locate(prompt, root, opts = {}) {
  const { maxHints = 5, minScore = 5 } = opts;
  let mapText;
  try { mapText = readFileSync(opts.mapFile ?? join(KIT_DIR, 'repomap.md'), 'utf8'); } catch { return { hints: [], reason: 'no repo map' }; }
  const files = parseMap(mapText);
  const cues = extractCues(prompt);
  if (!cues.idents.length && !cues.paths.length && !cues.words.length) return { hints: [], reason: 'no cues', cues };

  const identSet = new Set(cues.idents.flatMap((i) => [i, ...i.split('.')]));
  const identLower = new Set([...identSet].map((i) => i.toLowerCase()));
  const candidates = [];

  const allWords = [...cues.words, ...cues.joined];
  for (const f of files) {
    const segs = f.path.split('/');
    const base = segs.pop();
    const baseName = base.replace(/\.[^.]+$/, '');
    const mentioned = cues.paths.some((p) => f.path === p || f.path.endsWith(`/${p}`) || base === p);
    const nameHit = !GENERIC_PATH.has(baseName.toLowerCase()) && allWords.some((w) => wordsMatch(w, baseName));
    const dirParts = splitWords(segs.join('/')).filter((p) => !GENERIC_PATH.has(p));
    const dirHits = cues.words.filter((w) => dirParts.some((p) => wordsMatch(w, p)));
    const fileScore = (mentioned ? 10 : 0) + (nameHit ? 6 : 0) + 2 * dirHits.length;
    const fileWhy = [...(mentioned ? [base] : []), ...(nameHit ? [baseName] : []), ...dirHits];

    let best = 0;
    for (const s of f.syms) {
      let score = 0;
      const why = [];
      if (identSet.has(s.name)) { score += 10; why.push(s.name); }
      else if (identLower.has(s.name.toLowerCase())) { score += 8; why.push(s.name); }
      else if (cues.joined.some((j) => wordsMatch(j, s.name))) { score += 8; why.push(s.name); }
      else {
        const parts = splitWords(s.name);
        const hits = cues.words.filter((w) => parts.some((p) => wordsMatch(w, p)));
        if (hits.length) {
          score += 3 * hits.length + (hits.length >= parts.length ? 2 : 0);
          why.push(...hits);
        }
      }
      if (!score) continue;
      score += fileScore;
      best = Math.max(best, score);
      candidates.push({ path: f.path, sym: s, score, why: [...new Set([...why, ...fileWhy])] });
    }
    // A file that matches by name/path but not by any symbol is still a hint.
    if (!best && fileScore >= minScore) candidates.push({ path: f.path, sym: null, score: fileScore, why: fileWhy });
  }

  // Ties: a method beats its class (smaller range to read), then path order.
  const sorted = candidates.sort((a, b) => b.score - a.score || Number(Boolean(b.sym?.method)) - Number(Boolean(a.sym?.method)) || a.path.localeCompare(b.path));
  const floor = Math.max(minScore, Math.ceil((sorted[0]?.score ?? 0) / 2));
  const strong = sorted.filter((c) => c.score >= floor);
  // Many weak, equal matches = a vague prompt; hints would mislead more than help.
  if (strong.length > 20 && strong[0].score < 8) return { hints: [], reason: 'too ambiguous', cues };

  const perFile = new Map();
  const hints = [];
  const seen = new Set();
  for (const c of strong) {
    const key = `${c.path}#${c.sym ? c.sym.name : ''}`;
    if (seen.has(key) || (perFile.get(c.path) ?? 0) >= 2) continue;
    seen.add(key);
    perFile.set(c.path, (perFile.get(c.path) ?? 0) + 1);
    let range = '';
    let label = '';
    if (c.sym) {
      const r = findSymbol(root, c.path, c.sym.name);
      range = r ? `:${r.start}-${r.end}` : `:${c.sym.line}`;
      label = c.sym.method && c.sym.owner ? `${c.sym.owner}.${c.sym.name}` : c.sym.name;
    }
    hints.push({ path: c.path, range, label, score: c.score, why: c.why });
    if (hints.length >= maxHints) break;
  }
  return { hints, reason: hints.length ? 'ok' : 'no confident match', cues };
}

export function formatHints(hints) {
  if (!hints.length) return '';
  const why = [...new Set(hints.flatMap((h) => h.why))].slice(0, 6).join(', ');
  return [
    `[tokenkit] Likely locations for this request (repo-map match on: ${why}). Read these ranges first; search only if they turn out wrong:`,
    ...hints.map((h) => `- ${h.path}${h.range}${h.label ? `  ${h.label}` : ''}`)
  ].join('\n');
}
