import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { loadConfig } from './config.mjs';
import { estimateTokens } from './tokens.mjs';

// Compact, grep-friendly symbol index: one line per file, `Name:line`, methods
// as `.name:line`. The agent greps it (or reads it once) instead of opening
// files to discover where things live.

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.gradle', '.idea', '.vs',
  '.tokenkit', '.terraform', '.pytest_cache', '.mypy_cache']);
const GENERATED = /(\.min\.\w+|\.d\.ts|\.g\.cs|\.designer\.cs|_pb2\.py|\.pb\.go|\.generated\.\w+)$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.\w+$|_test\.go$|(^|\/)test_[^/]*\.py$|Tests?\.cs$/;

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

export function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.split('\0').filter(Boolean);
  } catch { /* not a git repo: walk */ }
  const files = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name));
      } else if (e.isFile()) {
        files.push(relative(root, join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return files;
}

function renderLine(f, level) {
  if (level >= 3 || !f.syms.length) return f.path;
  const syms = level >= 1 ? f.syms.filter((s) => !s.method) : f.syms;
  if (!syms.length) return f.path;
  return `${f.path} | ${syms.map((s) => `${s.method ? '.' : ''}${s.name}:${s.line}`).join(' ')}`;
}

export function buildMap(root, opts = {}) {
  const cfg = { ...loadConfig().map, ...opts };
  const exclude = cfg.exclude.map((s) => new RegExp(s));
  const files = [];
  for (const path of listFiles(root).sort()) {
    const ext = extname(path);
    if (!BY_EXT.has(ext.toLowerCase()) || GENERATED.test(path)) continue;
    if (path.split('/').some((seg) => SKIP_DIRS.has(seg))) continue;
    if (exclude.some((r) => r.test(path))) continue;
    let text;
    try {
      if (statSync(join(root, path)).size > cfg.maxFileKB * 1024) continue;
      text = readFileSync(join(root, path), 'utf8');
    } catch { continue; }
    files.push({ path, test: TEST_FILE.test(path), syms: extractSymbols(text, ext) });
  }

  const header = (level) => [
    `# Repo map · ${files.length} source files · detail level ${level}/4 · regenerate: node .tokenkit/tk.mjs map`,
    '# path | Symbol:line .method:line — grep this file for a name, then read only that line range.'
  ];
  // Degrade detail until it fits the budget: 0 full, 1 no methods, 2 no test
  // symbols, 3 paths only, 4 directory counts.
  for (let level = 0; level <= 4; level++) {
    let body;
    if (level === 4) {
      const dirs = new Map();
      for (const f of files) { const d = dirname(f.path); dirs.set(d, (dirs.get(d) || 0) + 1); }
      body = [...dirs].map(([d, n]) => `${d}/ (${n} files)`);
    } else {
      body = files.map((f) => renderLine(f, level === 2 && f.test ? 3 : level));
    }
    const text = [...header(level), ...body].join('\n') + '\n';
    const tokens = estimateTokens(text);
    if (tokens <= cfg.maxTokens || level === 4) return { text, tokens, level, files: files.length };
  }
}

export function writeMap(root, outFile, opts) {
  const r = buildMap(root, opts);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, r.text);
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
