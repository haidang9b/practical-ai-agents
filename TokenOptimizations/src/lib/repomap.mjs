import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { loadConfig } from './config.mjs';
import { estimateTokens, fmtTokens } from './tokens.mjs';

// Compact, grep-friendly symbol index: one line per file, `Name:line`, methods
// as `.name:line`. The agent greps it (or reads it once, when small) instead of
// opening files to discover where things live. It always lists every source
// file in full detail; above map.maxTokens it is grep-only and areas.md, a
// folder overview within the budget, is written next to it.

export const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.gradle', '.idea', '.vs',
  '.tokenkit', '.terraform', '.pytest_cache', '.mypy_cache']);
const GENERATED = /(\.min\.\w+|\.d\.ts|\.g\.cs|\.designer\.cs|_pb2\.py|\.pb\.go|\.generated\.\w+)$/i;
// Bump when the extractors change, so cached symbols are recomputed.
const CACHE_VERSION = 1;

const id = '([A-Za-z_$][\\w$]*)';
const LANGS = {
  js: {
    ext: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte'],
    top: [
      new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|type|enum|const|let|var|namespace)\\s+${id}`),
      new RegExp(`^(?:async\\s+)?function\\*?\\s+${id}`),
      new RegExp(`^(?:abstract\\s+)?class\\s+${id}`),
      new RegExp(`^(?:const|let)\\s+${id}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`),
      new RegExp(`^module\\.exports\\.${id}\\s*=`)
    ],
    cls: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/,
    method: new RegExp(`^\\s{2,4}(?:public\\s+|protected\\s+|static\\s+|async\\s+|override\\s+|get\\s+|set\\s+)*${id}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)?\\s*(?::[^={]+)?\\{?\\s*$`)
  },
  py: {
    ext: ['.py'],
    top: [/^class\s+(\w+)/, /^(?:async\s+)?def\s+(\w+)/],
    cls: /^class\s+/,
    method: /^ {4}(?:async\s+)?def\s+((?!_)\w+|__init__)/
  },
  go: {
    ext: ['.go'],
    top: [/^func\s+\([^)]*\)\s*(\w+)/, /^func\s+(\w+)/, /^type\s+(\w+)\s+/]
  },
  cs: {
    ext: ['.cs'],
    top: [/^\s*(?:(?:public|internal|protected|private|static|abstract|sealed|partial|readonly|file)\s+)*(?:class|interface|record|struct|enum)\s+(\w+)/],
    cls: /\b(class|interface|record|struct)\s+\w+/,
    method: /^\s+(?:public|internal|protected)\s+(?:(?:static|async|virtual|override|abstract|sealed|new|extern|unsafe)\s+)*(?!class\b|interface\b|record\b|struct\b|enum\b|event\b)[\w<>[\],.?\s]+?\s+(\w+)\s*(?:<[^>]*>)?\s*\(/
  },
  java: {
    ext: ['.java', '.kt', '.kts', '.scala'],
    top: [
      /^\s*(?:(?:public|private|protected|internal|abstract|final|sealed|open|data|static|inner|enum|annotation)\s+)*(?:class|interface|enum|record|object|trait)\s+(\w+)/,
      /^(?:(?:public|private|internal|inline|suspend)\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)\s*\(/
    ],
    cls: /\b(class|interface|enum|record|object)\s+\w+/,
    method: /^\s+(?:(?:public|protected|static|final|abstract|synchronized|override|suspend|open)\s+)+(?:fun\s+|[\w<>[\],.?\s]+?\s+)(\w+)\s*\(/
  },
  rs: {
    ext: ['.rs'],
    top: [/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|mod|const|static)\s+(\w+)/, /^impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?(\w+)/]
  },
  php: {
    ext: ['.php'],
    top: [/^\s*(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+(\w+)/, /^function\s+(\w+)/],
    cls: /^\s*(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+/,
    method: /^\s+(?:public\s+)?(?:static\s+)?function\s+((?!__)\w+|__construct)/
  },
  rb: {
    ext: ['.rb'],
    top: [/^\s*(?:class|module)\s+([\w:]+)/],
    cls: /^\s*(?:class|module)\s+/,
    method: /^\s+def\s+((?:self\.)?\w+[?!=]?)/
  }
};
const BY_EXT = new Map();
for (const lang of Object.values(LANGS)) for (const e of lang.ext) BY_EXT.set(e, lang);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'new', 'await', 'super', 'this', 'constructor', 'do', 'try', 'with']);
const MAX_METHODS = 15;

export function extractSymbols(text, ext) {
  const lang = BY_EXT.get(ext.toLowerCase());
  if (!lang) return [];
  const syms = [];
  let inClass = false;
  const lines = text.split(/\r?\n/);
  let methods = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let hit = false;
    for (const re of lang.top) {
      const m = re.exec(line);
      if (m) {
        syms.push({ name: m[1], line: i + 1, method: false });
        inClass = Boolean(lang.cls && lang.cls.test(line));
        hit = true;
        break;
      }
    }
    if (hit) continue;
    if (lang.method && (inClass || ext === '.cs' || ext === '.java' || ext === '.kt')) {
      const m = lang.method.exec(line);
      if (m && !KEYWORDS.has(m[1]) && methods < MAX_METHODS) {
        syms.push({ name: m[1], line: i + 1, method: true });
        methods++;
      }
    }
    // Leaving a JS/Python class body: a non-indented, non-empty line.
    if (inClass && /^\S/.test(line) && !/^[})\]]/.test(line) && ext !== '.cs' && ext !== '.java') inClass = false;
  }
  return syms;
}

// Every file git would show (tracked + untracked, minus ignored). Nested
// repositories and submodules are listed through their own git, so a parent
// folder holding a frontend repo and a backend repo gets one map.
export function listFiles(root) {
  let listed = [];
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
    listed = out.split('\0').filter(Boolean);
  } catch { /* not a git repo: walk */ }
  // Empty answer (e.g. the folder is ignored by a parent repo): scan instead.
  if (!listed.length) return walkFiles(root);
  const subs = submodules(root);
  const files = [];
  for (const p of listed) {
    // git shows an untracked nested repository as `dir/`, and a submodule as its bare path.
    const nested = p.endsWith('/') ? p.slice(0, -1) : subs.has(p) ? p : null;
    if (nested === null) files.push(p);
    else for (const q of listFiles(join(root, nested))) files.push(`${nested}/${q}`);
  }
  return files;
}

function submodules(root) {
  try {
    return new Set([...readFileSync(join(root, '.gitmodules'), 'utf8').matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => m[1]));
  } catch { return new Set(); }
}

function walkFiles(root) {
  const files = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        // A repository inside a plain folder: its own .gitignore applies.
        if (existsSync(join(abs, '.git'))) for (const q of listFiles(abs)) files.push(`${rel}/${q}`);
        else walk(abs);
      } else if (e.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(root);
  return files;
}

// The files the map lists. buildMap and mapIsStale must agree on this set, or
// the map looks stale forever and every prompt rebuilds it.
function sourceFiles(root, cfg) {
  const exclude = cfg.exclude.map((s) => new RegExp(s));
  return listFiles(root).filter((p) => BY_EXT.has(extname(p).toLowerCase()) && !GENERATED.test(p)
    && !p.split('/').some((seg) => SKIP_DIRS.has(seg)) && !exclude.some((r) => r.test(p))).sort();
}

const renderSyms = (syms) => syms.map((s) => `${s.method ? '.' : ''}${s.name}:${s.line}`).join(' ');

// opts.cache ({ path: [mtimeMs, size, symbols] }) skips re-reading unchanged
// files; the returned cache is the one to pass next time.
export function buildMap(root, opts = {}) {
  const cfg = { ...loadConfig().map, ...opts };
  const prev = opts.cache || {};
  const cache = {};
  const lines = [];
  let read = 0;
  const paths = sourceFiles(root, cfg);
  for (const path of paths) {
    let syms = '';
    try {
      const st = statSync(join(root, path));
      const hit = prev[path];
      if (hit && hit[0] === st.mtimeMs && hit[1] === st.size) syms = hit[2];
      else if (st.size <= cfg.maxFileKB * 1024) {
        syms = renderSyms(extractSymbols(readFileSync(join(root, path), 'utf8'), extname(path)));
        read++;
      }
      cache[path] = [st.mtimeMs, st.size, syms];
    } catch { /* vanished or unreadable: list the path only */ }
    lines.push(syms ? `${path} | ${syms}` : path);
  }

  const body = lines.join('\n');
  const tokens = estimateTokens(body);
  const big = tokens > cfg.maxTokens;
  const text = [
    `# Repo map · ${paths.length} source files · ~${fmtTokens(tokens)} tokens · regenerate: node .tokenkit/tk.mjs map`,
    big
      ? '# path | Symbol:line .method:line — too big to read whole: grep it for a name, then read only that line range. Folder overview: .tokenkit/areas.md'
      : '# path | Symbol:line .method:line — grep this file for a name, then read only that line range.',
    body
  ].join('\n') + '\n';
  return { text, tokens, files: paths.length, overview: big ? buildOverview(paths, cfg.maxTokens) : null, cache, read };
}

// Orientation for maps too big to read: folders with file counts and their
// subfolders, at the deepest folder depth that fits the budget.
function buildOverview(paths, budget) {
  const dirsOf = paths.map((p) => p.split('/').slice(0, -1));
  const header = `# Folder overview · ${paths.length} source files · symbols: grep .tokenkit/repomap.md`;
  let text = header;
  const deepest = dirsOf.reduce((m, d) => Math.max(m, d.length), 1);
  for (let depth = deepest; depth >= 1; depth--) {
    const groups = new Map();
    for (const segs of dirsOf) {
      const key = segs.slice(0, depth).join('/') || '.';
      const g = groups.get(key) ?? groups.set(key, { n: 0, subs: new Set() }).get(key);
      g.n++;
      if (segs.length > depth) g.subs.add(segs[depth]);
    }
    const lines = [...groups].map(([d, g]) => {
      const subs = [...g.subs];
      const list = subs.length ? `: ${subs.slice(0, 12).join(' ')}${subs.length > 12 ? ` (+${subs.length - 12})` : ''}` : '';
      return `${d}/ (${g.n} files)${list}`;
    });
    text = [header, ...lines].join('\n') + '\n';
    if (estimateTokens(text) <= budget) break;
  }
  return text;
}

// Stale = missing, older than maxAgeMinutes, a different number of source files
// than it lists, or any source file modified after it was written. Cheap: one
// file listing plus a stat per source file, no file reads.
export function mapIsStale(root, mapFile, maxAgeMinutes = loadConfig().map.maxAgeMinutes) {
  let mapTime, header;
  try {
    mapTime = statSync(mapFile).mtimeMs;
    header = readFileSync(mapFile, 'utf8').split('\n', 1)[0];
  } catch { return 'missing'; }
  if (/detail level/.test(header)) return 'old format';
  if (Date.now() - mapTime > maxAgeMinutes * 60_000) return 'old';
  const sources = sourceFiles(root, loadConfig().map);
  const listed = Number((/· (\d+) source files/.exec(header) || [])[1]);
  if (Number.isFinite(listed) && Math.abs(listed - sources.length) > 0) return 'file count changed';
  for (const p of sources) {
    try { if (statSync(join(root, p)).mtimeMs > mapTime) return 'files changed'; } catch { /* deleted */ }
  }
  return null;
}

// Writes the map, the folder overview (only when the map is over budget) and
// the per-file symbol cache that keeps rebuilds of large repos fast.
export function writeMap(root, outFile, opts = {}) {
  const maxFileKB = opts.maxFileKB ?? loadConfig().map.maxFileKB;
  const dir = dirname(outFile);
  const cacheFile = join(dir, 'cache', 'repomap.json');
  let cache;
  try {
    const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (c.v === CACHE_VERSION && c.maxFileKB === maxFileKB) cache = c.files;
  } catch { /* first build */ }
  const r = buildMap(root, { ...opts, cache });
  mkdirSync(join(dir, 'cache'), { recursive: true });
  writeFileSync(outFile, r.text);
  if (r.overview) writeFileSync(join(dir, 'areas.md'), r.overview);
  else rmSync(join(dir, 'areas.md'), { force: true });
  try { writeFileSync(cacheFile, JSON.stringify({ v: CACHE_VERSION, maxFileKB, files: r.cache })); } catch { /* next build reads everything */ }
  return r;
}

// Resolve `file#symbol` to a line range using the same extractors.
export function findSymbol(root, path, name) {
  let text;
  try { text = readFileSync(join(root, path), 'utf8'); } catch { return null; }
  const syms = extractSymbols(text, extname(path));
  const idx = syms.findIndex((s) => s.name === name || s.name.endsWith(`.${name}`));
  if (idx < 0) return null;
  const start = syms[idx].line;
  const total = text.split(/\r?\n/).length;
  const next = syms.slice(idx + 1).find((s) => syms[idx].method || !s.method);
  return { start, end: next ? next.line - 1 : total };
}
