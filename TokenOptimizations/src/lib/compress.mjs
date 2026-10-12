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

const ERROR = new RegExp([
  /\b(error|errors|errored|err!|fail|failed|failing|failure|failures|fatal|exception|panic|traceback|assert\w*|denied|cannot|unable to|undefined|segmentation|expected|received|not found)\b/,
  /\w(error|exception)\b/, // ValueError:, System.InvalidOperationException:
  /\b(abort(ed)?|crash(ed)?|timed out|timeout of|exceeded timeout|unhandled|killed|out of memory|stack ?overflow|segfault|core dumped)\b/,
  /\bE(NOENT|ACCES|PERM|EXIST|ADDRINUSE|CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND|PIPE)\b/,
  /^\s*(Actual|But was)\s*:/, // the other half of an Expected: line (xUnit, NUnit)
  /✗|✕|✖|❌|^\s*●|^E\s|^\s*>\s+\d+\s*\|/
].map((r) => r.source).join('|'), 'i');
const WARN = /\bwarn(ing)?s?\b/i;
// A source location: a stack frame or compiler pointer to a file and line.
// Library frames never get here (LIB_FRAME collapses them first).
const LOCATION = /:line \d+\s*$|[\w./\\-]+\.[A-Za-z]{1,6}(:\d+){1,2}\b|[\w./\\-]+\.[A-Za-z]{1,6}\(\d+(,\d+)?\)|^\s*File ".+", line \d+/;
const CODE = /\b(?:error|warning)\s*\[?([A-Z]{1,5}\d{3,5})\b/i; // error CS0103, error TS2304, error[E0308], warning CS8618
const FILE = /[\w.-]+\.[A-Za-z]{1,6}(?=[(:])/;
// `path(12,5): ` / `path:12:5 - ` at the start of a compiler error, and MSBuild's trailing `[x.csproj]`.
const LOC_PREFIX = /^.*?\.[A-Za-z]{1,6}(\(\d+(,\d+)?\)|(:\d+){1,2})\s*[:-]?\s*/;
const FOLD_AFTER = 3; // identical errors at other locations: show this many in full

const anyMatch = (res, s) => res.some((r) => r.test(s));
const shape = (s) => s.replace(/0x[0-9a-f]+|\d+/gi, '0').replace(/(["'`]).*?\1/g, '$1$1');
const tally = (xs) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);

export function compress(raw, opts = {}) {
  const o = {
    exitCode: 1, maxLines: 80, maxErrorLines: 150, headLines: 6, tailLines: 20, successTail: 8, context: 2,
    noise: [], errors: [], ...opts
  };
  const noise = [...NOISE, ...o.noise.map((s) => new RegExp(s))];
  const errs = [ERROR, ...o.errors.map((s) => new RegExp(s, 'i'))];
  const isErr = (s) => anyMatch(errs, s);

  // A progress line redrawn with \r keeps only its final state, plus any
  // error it overwrote on the way.
  const lines = String(raw)
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((l) => {
      if (!l.includes('\r')) return [l];
      const parts = l.split('\r').filter((p) => p.trim());
      const last = parts.pop() ?? '';
      return [...parts.filter((p) => isErr(p) && !isErr(last)), last];
    })
    .map((l) => l.trimEnd());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  const stats = { rawLines: lines.length, noise: 0, passed: 0, frames: 0, warnings: 0, repeats: 0 };
  const warnings = new Set();
  const seenErrors = new Set();
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
    if (WARN.test(line) && !/^\s*\d+ warn/i.test(line)) warnings.add(line); // not "60 Warning(s)"
    // MSBuild lists every error again in its summary: show each located error once.
    if (isErr(line) && LOCATION.test(line)) {
      if (seenErrors.has(line)) { stats.repeats++; continue; }
      seenErrors.add(line);
    }
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
  let groups = [];
  const dropped = [];
  const folded = [];
  if (rows.length <= cap) {
    picked = rows.map((_, i) => i);
  } else {
    const keep = new Set();
    for (let i = 0; i < Math.min(head, rows.length); i++) keep.add(i);
    for (let i = Math.max(0, rows.length - tail); i < rows.length; i++) keep.add(i);
    const errIdx = rows.map((r, i) => (isErr(r.text) ? i : -1)).filter((i) => i >= 0);
    const errSet = new Set(errIdx);
    // Up to 3 source locations on each side of an error, before the next error:
    // the stack frame after "Actual: 81", the File "…" lines before "ValueError".
    const locations = (i) => {
      const found = [];
      for (const step of [1, -1]) {
        let n = 0;
        for (let k = i + step; k >= 0 && k < rows.length && Math.abs(k - i) <= 8 && !errSet.has(k) && n < 3; k += step) {
          if (LOCATION.test(rows[k].text)) { found.push(k); n++; }
        }
      }
      return found;
    };

    // 1. Every error line and its locations: what the agent has to act on.
    //    They have their own budget, so context never crowds them out. The
    //    same error at many locations (one renamed type, 400 files) is shown
    //    FOLD_AFTER times and counted, so it can't use up the budget meant
    //    for different errors.
    let errorBudget = ok ? o.successTail : o.maxErrorLines;
    const seen = new Map();
    for (const i of errIdx) {
      const t = rows[i].text;
      if (!keep.has(i) && LOCATION.test(t)) {
        const key = t.replace(LOC_PREFIX, '').replace(/\s*\[[^\]]+\]\s*$/, '');
        const g = seen.get(key) ?? seen.set(key, { n: 0, files: new Set() }).get(key);
        if (++g.n > FOLD_AFTER) { g.files.add(FILE.exec(t)?.[0]); folded.push(i); continue; }
      }
      const must = [i, ...locations(i)].filter((k) => !keep.has(k));
      if (must.length <= errorBudget) { must.forEach((k) => keep.add(k)); errorBudget -= must.length; }
      else if (!keep.has(i)) dropped.push(i);
    }
    // 2. Context around errors, earliest first (often the root cause), within the line cap.
    let contextBudget = cap - Math.min(rows.length, head + tail);
    for (const i of errIdx) {
      if (!keep.has(i)) continue;
      const win = [];
      for (let k = Math.max(0, i - o.context); k <= Math.min(rows.length - 1, i + o.context); k++) {
        if (!keep.has(k)) win.push(k);
      }
      if (win.length <= contextBudget) { win.forEach((k) => keep.add(k)); contextBudget -= win.length; }
    }
    picked = [...keep].sort((a, b) => a - b);
    groups = [...seen].filter(([, g]) => g.n > FOLD_AFTER).sort((a, b) => b[1].n - a[1].n);
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
  if (stats.repeats) notes.push(`${stats.repeats} repeated error line(s) shown once`);
  stats.warnings = warnings.size;
  if (warnings.size) {
    const codes = tally([...warnings].map((w) => CODE.exec(w)?.[1]).filter(Boolean)).slice(0, 3);
    notes.push(`${warnings.size} warning line(s) in full log${codes.length ? ` (${codes.join(', ')})` : ''}`);
  }
  stats.foldedErrorLines = folded.length;
  for (const [key, g] of groups.slice(0, 3)) {
    const files = new Set([...g.files].filter(Boolean));
    notes.push(`same error at ${g.n - FOLD_AFTER} more location(s)${files.size ? ` in ${files.size} file(s)` : ''}: "${key.slice(0, 120)}"`);
  }
  if (groups.length > 3) notes.push(`${groups.length - 3} more repeated error(s) folded`);
  // Past the error budget: say exactly what is missing, so nothing vanishes silently.
  stats.droppedErrorLines = dropped.length;
  if (dropped.length) {
    const texts = dropped.map((i) => rows[i].text);
    const codes = tally(texts.map((t) => CODE.exec(t)?.[1]).filter(Boolean)).slice(0, 4);
    const files = new Set(texts.map((t) => FILE.exec(t)?.[0]).filter(Boolean));
    notes.push(`${dropped.length} more error line(s) not shown${codes.length ? ` (${codes.join(', ')})` : ''}${files.size ? ` in ${files.size} file(s)` : ''}; grep the log`);
  }

  const text = out.join('\n');
  return {
    text,
    notes,
    stats: { ...stats, keptLines: out.length, rawTokens: estimateTokens(raw), keptTokens: estimateTokens(text) }
  };
}
