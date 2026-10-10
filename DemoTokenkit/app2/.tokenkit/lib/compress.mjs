import { estimateTokens } from './tokens.mjs';

// Shrinks build/test/install output to what a model needs to act on:
// failures with context, the first lines, and the trailing summary.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?/g;

// Lines that never help the model (progress, downloads, restore chatter).
const NOISE = [
  /^\s*[[(|]?[#=>\-\s.·█▓▒░━─]{8,}[\])|]?\s*\d{1,3}(\.\d+)?\s?%/,
  /^\s*\d{1,3}(\.\d+)?\s?%\s*$/,
  /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\-]\s*$/,
  /^npm (warn|notice)\b/i,
  /^\s*(Collecting|Downloading|Using cached|Requirement already satisfied|Obtaining|Preparing metadata|Building wheel|Created wheel|Stored in directory)\b/,
  /^remote: (Counting|Compressing|Enumerating|Total)|^(Receiving|Resolving) (objects|deltas)/,
  /^\s*(Determining projects to restore|All projects are up-to-date for restore)/,
  /^\[INFO\] Download(ing|ed) from|^Download(ing)? https?:/,
  /^\s*(Compiling|Downloaded|Downloading|Fresh|Checking|Locking|Adding|Blocking waiting)\s+\S+ v\d/,
  /^go: (downloading|finding|extracting)\b/,
  /^#\d+ (sha256:|extracting|resolve |transferring)/,
  /^\s*# Subtest: |^\s+duration_ms: [\d.]+$|^\s+type: '(test|suite)'$|^\s{2,}(---|\.\.\.)$/
];

// Passing-test lines: dropped and counted.
const PASS = [
  /^\s*(✓|✔|√)\s/,
  /^\s*PASS\s/,
  /\bPASSED\b/,
  /^\s*Passed\s+\S/,
  /^(=== (RUN|PAUSE|CONT)|\s*--- PASS:)/,
  /^ok\s+\S+\s+(\(cached\)|[\d.]+s)/,
  /^test \S+ \.\.\. ok$/,
  /^\[\s+(OK|RUN)\s+\]/,
  /^\s*ok \d+ - /,
  /^\S+\.py\s+\.+\s+\[\s*\d+%\]$/
];

// Framework/library stack frames: runs collapse into one marker line.
const LIB_FRAME = [
  /^[#\s]*\sat .*(node:internal|node:diagnostics|node_modules[\\/]|\(internal\/|\(native\))/,
  /^\s+(async )?[\w$.<>]+ \(node:[\w/]+:\d+:\d+\)$/,
  /^\s+at (java\.|javax\.|jdk\.|sun\.|org\.junit\.|org\.springframework\.|org\.apache\.|kotlin\.|kotlinx\.|reactor\.)/,
  /^\s+at (System\.|Microsoft\.|Xunit\.|NUnit\.|Castle\.)/,
  /^\s+File ".*([\\/](site|dist)-packages[\\/]|[\\/]lib[\\/]python\d)/,
  /^\s+\d+: .*(std::|core::|rust_begin_unwind|__rust|backtrace::)|^\s+at \/rustc\//,
  /^\s+\/usr\/(local\/)?go\/src\/|^(runtime|testing)\.\S+\(/
];

const ERROR = /\b(error|errors|err!|fail|failed|failure|failures|fatal|exception|panic|traceback|assert\w*|denied|cannot|unable to|undefined|segmentation|expected|received|not found)\b|✗|✕|✖|❌|^\s*●|^E\s|^\s*>\s+\d+\s*\|/i;
const WARN = /\bwarn(ing)?s?\b/i;

const anyMatch = (res, s) => res.some((r) => r.test(s));
const shape = (s) => s.replace(/0x[0-9a-f]+|\d+/gi, '0').replace(/(["'`]).*?\1/g, '$1$1');

export function compress(raw, opts = {}) {
  const o = {
    exitCode: 1, maxLines: 80, headLines: 6, tailLines: 20, successTail: 8, context: 2,
    noise: [], errors: [], ...opts
  };
  const noise = [...NOISE, ...o.noise.map((s) => new RegExp(s))];
  const errs = [ERROR, ...o.errors.map((s) => new RegExp(s, 'i'))];
  const isErr = (s) => anyMatch(errs, s);

  const lines = String(raw)
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => (l.includes('\r') ? l.split('\r').filter((p) => p.trim()).pop() ?? '' : l).trimEnd());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const stats = { rawLines: lines.length, noise: 0, passed: 0, frames: 0, warnings: 0 };
  const entries = []; // { text, n }
  let pendingFrames = 0;
  let skipPyCode = false;
  const flushFrames = () => {
    if (pendingFrames) entries.push({ text: `    … ${pendingFrames} library frame line(s)`, n: 1 });
    pendingFrames = 0;
  };

  for (const line of lines) {
    if (skipPyCode) {
      skipPyCode = false;
      if (/^\s{4,}\S/.test(line) && !/^\s+File "/.test(line)) { pendingFrames++; stats.frames++; continue; }
    }
    if (anyMatch(LIB_FRAME, line)) {
      pendingFrames++; stats.frames++;
      skipPyCode = /^\s+File "/.test(line);
      continue;
    }
    flushFrames();
    if (anyMatch(noise, line)) { stats.noise++; continue; }
    if (anyMatch(PASS, line) && !/\b(fail|error)/i.test(line)) { stats.passed++; continue; }
    if (WARN.test(line)) stats.warnings++;
    const prev = entries[entries.length - 1];
    if (line === '' && (!prev || prev.text === '')) continue;
    if (prev && prev.text === line) { prev.n++; continue; }
    entries.push({ text: line, n: 1 });
  }
  flushFrames();

  // Collapse runs of same-shaped non-error lines (e.g. 200 "Copying file N of M").
  // Error lines are never collapsed: each one may point at a different location.
  const rows = [];
  const collapsible = (e) => e.text !== '' && !isErr(e.text);
  for (let i = 0; i < entries.length; ) {
    let j = i + 1;
    const s = shape(entries[i].text);
    if (collapsible(entries[i])) {
      while (j < entries.length && collapsible(entries[j]) && shape(entries[j].text) === s) j++;
    }
    const run = j - i;
    if (run >= 5) {
      // Keep the last one too: it usually shows the final state of the run.
      rows.push(entries[i], entries[i + 1], { text: `  … +${run - 3} similar line(s)`, n: 1 }, entries[j - 1]);
    } else {
      rows.push(...entries.slice(i, j));
    }
    i = j;
  }

  const render = (e) => (e.n > 1 ? `${e.text}  (×${e.n})` : e.text);
  const ok = o.exitCode === 0;
  const head = ok ? 0 : o.headLines;
  const tail = ok ? o.successTail : o.tailLines;
  const cap = ok ? o.successTail * 2 : o.maxLines;

  let picked;
  if (rows.length <= cap) {
    picked = rows.map((_, i) => i);
  } else {
    const keep = new Set();
    for (let i = 0; i < Math.min(head, rows.length); i++) keep.add(i);
    for (let i = Math.max(0, rows.length - tail); i < rows.length; i++) keep.add(i);
    let droppedErr = 0;
    rows.forEach((r, i) => {
      if (!isErr(r.text)) return;
      const win = [];
      for (let k = Math.max(0, i - o.context); k <= Math.min(rows.length - 1, i + o.context); k++) {
        if (!keep.has(k)) win.push(k);
      }
      // First errors are usually the root cause; later ones are often cascades.
      if (keep.size + win.length <= cap) win.forEach((k) => keep.add(k));
      else droppedErr++;
    });
    picked = [...keep].sort((a, b) => a - b);
    stats.droppedErrorLines = droppedErr;
  }

  const out = [];
  let last = -1;
  for (const i of picked) {
    if (i > last + 1) out.push(`… [${i - last - 1} line(s) omitted]`);
    out.push(render(rows[i]));
    last = i;
  }
  if (last < rows.length - 1) out.push(`… [${rows.length - 1 - last} line(s) omitted]`);

  const notes = [];
  if (stats.passed) notes.push(`${stats.passed} passing-test line(s) hidden`);
  if (stats.noise) notes.push(`${stats.noise} progress/noise line(s) hidden`);
  if (stats.frames) notes.push(`${stats.frames} library stack-frame line(s) collapsed`);
  if (stats.warnings) notes.push(`${stats.warnings} warning line(s) in full log`);
  if (stats.droppedErrorLines) notes.push(`${stats.droppedErrorLines} later error line(s) cut; grep the log`);

  const text = out.join('\n');
  return {
    text,
    notes,
    stats: { ...stats, keptLines: out.length, rawTokens: estimateTokens(raw), keptTokens: estimateTokens(text) }
  };
}
