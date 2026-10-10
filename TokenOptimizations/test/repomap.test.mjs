import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMap, extractSymbols, findSymbol } from '../src/lib/repomap.mjs';

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

test('buildMap degrades detail to fit the budget, and findSymbol resolves ranges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-map-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'export function ignored() {}');
  for (let i = 0; i < 40; i++) {
    const body = Array.from({ length: 10 }, (_, k) => `export class Widget${i}x${k} {\n  render() {\n  }\n}`).join('\n');
    writeFileSync(join(dir, 'src', `w${i}.ts`), body);
  }
  const full = buildMap(dir, { maxTokens: 100000 });
  assert.equal(full.level, 0);
  assert.match(full.text, /src\/w0\.ts \| Widget0x0:1 \.render:2/);
  assert.doesNotMatch(full.text, /ignored/);
  const tight = buildMap(dir, { maxTokens: 600 });
  assert.ok(tight.level > 0 && tight.tokens <= 600, `level ${tight.level}, ${tight.tokens} tokens`);
  assert.deepEqual(findSymbol(dir, 'src/w3.ts', 'Widget3x1'), { start: 5, end: 8 });
});
