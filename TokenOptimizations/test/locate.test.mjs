import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCues, formatHints, locate, stem } from '../src/lib/locate.mjs';
import { writeMap } from '../src/lib/repomap.mjs';

// A small but realistic app: the hints must point at the right code for plain requests.
const APP = {
  'src/cart/cart.ts': 'export class Cart {\n  add(item: Item, qty = 1) {\n  }\n  total(): number {\n    return 0;\n  }\n}\n',
  'src/cart/discount.ts': 'export function applyDiscount(total: number, pct: number) {\n  return total - total * pct;\n}\n\nexport function couponCode(code: string) {\n  return code.trim();\n}\n',
  'src/checkout/checkout.ts': 'export async function placeOrder(cart: Cart) {\n}\n\nexport function calculateShipping(weightKg: number) {\n  return weightKg * 2;\n}\n',
  'src/auth/login.ts': 'export function validateUser(name: string) {\n}\n\nexport function hashPassword(pw: string) {\n}\n',
  'src/auth/session.ts': 'export class SessionStore {\n  refreshToken(id: string) {\n  }\n}\n',
  'src/orders/orderRepository.ts': 'export class OrderRepository {\n  findByCustomer(id: string) {\n  }\n}\n',
  'src/utils/date.ts': 'export function parseRange(s: string) {\n}\n',
  'src/api/routes.ts': 'export function registerRoutes(app: App) {\n}\n'
};
const ROOT = mkdtempSync(join(tmpdir(), 'tk-locate-'));
for (const [p, body] of Object.entries(APP)) {
  mkdirSync(dirname(join(ROOT, p)), { recursive: true });
  writeFileSync(join(ROOT, p), body);
}
const MAP = join(ROOT, '.tokenkit', 'repomap.md');
writeMap(ROOT, MAP);
const first = (prompt) => locate(prompt, ROOT, { mapFile: MAP }).hints[0];

test('stemmer equates inflections, not look-alikes', () => {
  for (const [a, b] of [['applied', 'apply'], ['validation', 'validate'], ['orders', 'order'], ['compressor', 'compress'], ['denied', 'deny']]) {
    assert.equal(stem(a), stem(b), `${a} ~ ${b}`);
  }
  for (const [a, b] of [['repo', 'report'], ['readme', 'read'], ['command', 'common'], ['check', 'checkout'], ['cart', 'card']]) {
    assert.notEqual(stem(a), stem(b), `${a} !~ ${b}`);
  }
});

test('plain-language requests point at the right symbol and range', () => {
  const cases = [
    ['the discount is applied wrong: 10 percent off 200 gives -1800', 'src/cart/discount.ts', 'applyDiscount'],
    ['users can log in with an empty name, validation is missing', 'src/auth/login.ts', 'validateUser'],
    ['shipping cost is calculated twice for heavy parcels', 'src/checkout/checkout.ts', 'calculateShipping'],
    ['refresh token expires too early in the session store', 'src/auth/session.ts', 'SessionStore.refreshToken'],
    ['find orders by customer returns duplicates', 'src/orders/orderRepository.ts', 'OrderRepository.findByCustomer'],
    ['why is `placeOrder` so slow?', 'src/checkout/checkout.ts', 'placeOrder']
  ];
  for (const [prompt, path, label] of cases) {
    const h = first(prompt);
    assert.ok(h, `no hint for: ${prompt}`);
    assert.equal(h.path, path, prompt);
    assert.equal(h.label, label, prompt);
    assert.match(h.range, /^:\d+-\d+$/, prompt);
  }
});

test('file names and compound words match ("repo map" -> repomap, cart.ts mentioned)', () => {
  assert.equal(first('in cart.ts the total ignores quantity').path, 'src/cart/cart.ts');
  assert.deepEqual(extractCues('make the repo map faster').joined, ['repomap', 'mapfaster']);
});

test('vague or unrelated prompts inject nothing', () => {
  for (const p of ['can you help me with this?', 'update the readme', 'what is the capital of France', 'thanks, looks good']) {
    assert.deepEqual(locate(p, ROOT, { mapFile: MAP }).hints, [], p);
  }
});

test('hint text is short and actionable', () => {
  const text = formatHints(locate('the discount is applied twice', ROOT, { mapFile: MAP }).hints);
  assert.match(text, /^\[tokenkit\] Likely locations/);
  assert.match(text, /- src\/cart\/discount\.ts:1-4 {2}applyDiscount/);
  assert.ok(text.split('\n').length <= 6);
});

// The real hook, fed the payload VS Code sends (UserPromptSubmit: { prompt }).
test('prompt hook: plain language -> additionalContext; TaskSpec -> expansion; chit-chat -> nothing', () => {
  const kit = join(ROOT, '.tokenkit');
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  spawnSync(process.execPath, ['-e', `require('fs').cpSync(${JSON.stringify(src)}, ${JSON.stringify(kit)}, { recursive: true })`]);
  writeMap(ROOT, MAP); // the copy may carry the toolkit's own map; install filters it, a raw copy doesn't
  const run = (prompt) => {
    const r = spawnSync(process.execPath, [join(kit, 'hooks', 'prompt.mjs')], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: ROOT }), encoding: 'utf8',
      env: { ...process.env, TOKENKIT_LOG_DIR: mkdtempSync(join(tmpdir(), 'tk-plog-')) }
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  const nl = run('the discount is applied wrong for 10 percent');
  assert.equal(nl.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(nl.hookSpecificOutput.additionalContext, /src\/cart\/discount\.ts:1-4 {2}applyDiscount/);
  assert.equal(nl.additionalContext, nl.hookSpecificOutput.additionalContext);
  const ts = run('fix @src/cart/discount.ts#applyDiscount pct is a percent +test >diff');
  assert.match(ts.hookSpecificOutput.additionalContext, /Scope: src\/cart\/discount\.ts lines 1-4 \(applyDiscount\)/);
  assert.equal(run('thanks!'), null);
});
