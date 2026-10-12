import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildMap, extractSymbols, findSymbol, listFiles, mapIsStale, writeMap } from '../src/lib/repomap.mjs';

const names = (syms) => syms.map((s) => `${s.method ? '.' : ''}${s.name}:${s.line}`).join(' ');

test('typescript: exports, classes, methods, arrow functions', () => {
  const src = [
    "import x from 'y';",
    'export interface User { id: string }',
    'export class AuthService {',
    '  constructor(private db: Db) {}',
    '  async login(name: string): Promise<User> {',
    '    if (name) {',
    '      return this.db.find(name);',
    '    }',
    '  }',
    '  logout() {',
    '  }',
    '}',
    'export const hash = (s: string) => s;',
    'function helper() {}'
  ].join('\n');
  assert.equal(names(extractSymbols(src, '.ts')), 'User:2 AuthService:3 .login:5 .logout:10 hash:13 helper:14');
});

test('python: classes, public methods, functions', () => {
  const src = 'class Repo:\n    def __init__(self):\n        pass\n    def _private(self):\n        pass\n    def get(self, id):\n        pass\n\ndef main():\n    pass\n';
  assert.equal(names(extractSymbols(src, '.py')), 'Repo:1 .__init__:2 .get:6 main:9');
});

test('c#, go and rust declarations', () => {
  const cs = 'namespace App;\npublic sealed class OrderService\n{\n    public async Task<Order> PlaceAsync(Cart cart)\n    {\n    }\n    private void Hidden() {}\n}\n';
  assert.equal(names(extractSymbols(cs, '.cs')), 'OrderService:2 .PlaceAsync:4');
  const go = 'package x\n\ntype Server struct {}\n\nfunc (s *Server) Start() error {\n}\n\nfunc New() *Server {\n}\n';
  assert.equal(names(extractSymbols(go, '.go')), 'Server:3 Start:5 New:8');
  const rs = 'pub struct Cache;\nimpl Cache {\n    pub fn get(&self) {}\n}\npub(crate) async fn load() {}\n';
  assert.equal(names(extractSymbols(rs, '.rs')), 'Cache:1 Cache:2 get:3 load:5');
});

test('buildMap keeps full detail at any size and adds a folder overview over budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-map-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'export function ignored() {}');
  for (let i = 0; i < 40; i++) {
    const body = Array.from({ length: 10 }, (_, k) => `export class Widget${i}x${k} {\n  render() {\n  }\n}`).join('\n');
    writeFileSync(join(dir, 'src', `w${i}.ts`), body);
  }
  const full = buildMap(dir, { maxTokens: 100000 });
  assert.equal(full.overview, null);
  assert.match(full.text, /src\/w0\.ts \| Widget0x0:1 \.render:2/);
  assert.doesNotMatch(full.text, /ignored/);
  const tight = buildMap(dir, { maxTokens: 600 });
  const body = (r) => r.text.split('\n').slice(2).join('\n');
  assert.equal(body(tight), body(full), 'same full-detail body');
  assert.match(tight.text, /src\/w39\.ts \| Widget39x0:1 \.render:2/, 'every file keeps its symbols');
  assert.match(tight.text, /too big to read whole/);
  assert.match(tight.overview, /^src\/ \(40 files\)$/m);
  assert.deepEqual(findSymbol(dir, 'src/w3.ts', 'Widget3x1'), { start: 5, end: 8 });
});

test('regression: oversized and excluded files no longer make the map stale forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-stale-'));
  writeFileSync(join(dir, 'Order.cs'), 'public class Order\n{\n}\n');
  writeFileSync(join(dir, 'Snapshot.cs'), `public class Snapshot {}\n${'// x\n'.repeat(70000)}`);
  const out = join(dir, '.tokenkit', 'repomap.md');
  const r = writeMap(dir, out, { maxFileKB: 64 });
  assert.equal(r.files, 2);
  assert.match(r.text, /^Snapshot\.cs$/m, 'too big to index: listed by path');
  assert.equal(mapIsStale(dir, out), null);
});

test('writeMap re-reads only changed files on later builds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-cache-'));
  for (let i = 0; i < 5; i++) writeFileSync(join(dir, `m${i}.py`), `def f${i}():\n    pass\n`);
  const out = join(dir, '.tokenkit', 'repomap.md');
  assert.equal(writeMap(dir, out).read, 5);
  assert.equal(writeMap(dir, out).read, 0);
  writeFileSync(join(dir, 'm2.py'), 'def renamed():\n    pass\n');
  const later = new Date(Date.now() + 5000);
  utimesSync(join(dir, 'm2.py'), later, later);
  const r = writeMap(dir, out);
  assert.equal(r.read, 1);
  assert.match(r.text, /^m2\.py \| renamed:1$/m);
});

test('listFiles covers nested repos: a folder of repos, and repos inside a repo', () => {
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  const repo = (dir, file, body) => {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), body);
    writeFileSync(join(dir, '.gitignore'), 'generated/\n');
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, 'generated', 'big.ts'), 'export const x = 1;\n');
    git(dir, 'init', '-q');
  };
  // A plain folder holding a frontend repo and a backend repo.
  const parent = mkdtempSync(join(tmpdir(), 'tk-multi-'));
  repo(join(parent, 'frontend'), 'src/App.tsx', 'export function App() {}\n');
  repo(join(parent, 'backend'), 'Api/OrderService.cs', 'public class OrderService\n{\n}\n');
  assert.deepEqual(listFiles(parent).filter((p) => !p.endsWith('.gitignore')).sort(), ['backend/Api/OrderService.cs', 'frontend/src/App.tsx']);
  // The same two repos inside a repo that does not track them.
  writeFileSync(join(parent, 'README.md'), '# workspace\n');
  git(parent, 'init', '-q');
  const files = listFiles(parent);
  assert.ok(files.includes('README.md') && files.includes('frontend/src/App.tsx') && files.includes('backend/Api/OrderService.cs'), files.join(', '));
  assert.ok(!files.some((p) => p.includes('generated/')), 'each nested repo keeps its own .gitignore');
});
