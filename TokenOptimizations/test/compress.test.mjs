import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compress } from '../src/lib/compress.mjs';

const jestFail = [
  '> app@1.0.0 test',
  '> jest',
  '',
  ...Array.from({ length: 120 }, (_, i) => `PASS src/mod${i}.test.js`),
  'FAIL src/sum.test.js',
  '  ● sum › adds',
  '',
  '    expect(received).toBe(expected) // Object.is equality',
  '',
  '    Expected: 3',
  '    Received: 4',
  '',
  '    > 4 |   expect(sum(1, 2)).toBe(3);',
  '',
  '      at Object.<anonymous> (src/sum.test.js:4:21)',
  '      at Promise.then.completed (node_modules/jest-circus/build/utils.js:298:28)',
  '      at new Promise (<anonymous>)',
  '      at callAsyncCircusFn (node_modules/jest-circus/build/utils.js:231:10)',
  ...Array.from({ length: 60 }, (_, i) => `  ✓ case ${i} (1 ms)`),
  'Tests:       1 failed, 180 passed, 181 total',
  'Time:        4.2 s'
].join('\n');

test('keeps the failure and summary, drops passing lines and library frames', () => {
  const r = compress(jestFail, { exitCode: 1 });
  assert.match(r.text, /● sum › adds/);
  assert.match(r.text, /Expected: 3/);
  assert.match(r.text, /Received: 4/);
  assert.match(r.text, /src\/sum\.test\.js:4:21/);
  assert.match(r.text, /Tests: {7}1 failed/);
  assert.doesNotMatch(r.text, /PASS src\/mod7/);
  assert.doesNotMatch(r.text, /jest-circus/);
  assert.equal(r.stats.passed, 180);
  assert.ok(r.stats.keptTokens < r.stats.rawTokens / 5, `${r.stats.keptTokens} vs ${r.stats.rawTokens}`);
});

test('success output shrinks to the tail', () => {
  const raw = Array.from({ length: 500 }, (_, i) => `compiling module_${i}.rs`).join('\n') + '\nFinished release in 12.3s';
  const r = compress(raw, { exitCode: 0 });
  assert.match(r.text, /Finished release/);
  assert.ok(r.text.split('\n').length <= 16);
});

test('strips ANSI, carriage-return progress and duplicate lines', () => {
  const raw = '\x1b[32mstart\x1b[0m\nprogress 10%\rprogress 50%\rprogress 100%\nretrying\nretrying\nretrying\nerror: boom';
  const r = compress(raw, { exitCode: 1 });
  assert.doesNotMatch(r.text, /\x1b/);
  assert.match(r.text, /progress 100%/);
  assert.doesNotMatch(r.text, /progress 10%/);
  assert.match(r.text, /retrying {2}\(×3\)/);
  assert.match(r.text, /error: boom/);
});

test('python tracebacks lose site-packages frames but keep user frames', () => {
  const raw = [
    'Traceback (most recent call last):',
    '  File "/app/main.py", line 10, in <module>',
    '    run()',
    '  File "/usr/lib/python3.12/site-packages/click/core.py", line 1157, in __call__',
    '    return self.main(*args, **kwargs)',
    '  File "/app/svc.py", line 4, in run',
    '    raise ValueError("bad config")',
    'ValueError: bad config'
  ].join('\n');
  const r = compress(raw, { exitCode: 1 });
  assert.match(r.text, /main\.py/);
  assert.match(r.text, /svc\.py/);
  assert.doesNotMatch(r.text, /click\/core\.py/);
  assert.doesNotMatch(r.text, /self\.main/);
  assert.match(r.text, /ValueError: bad config/);
});

test('runs of same-shaped lines collapse but keep first, second and last', () => {
  const raw = Array.from({ length: 300 }, (_, i) => `copying file ${i} of 300`).join('\n');
  const r = compress(raw, { exitCode: 1 });
  assert.equal(r.text, 'copying file 0 of 300\ncopying file 1 of 300\n  … +297 similar line(s)\ncopying file 299 of 300');
});

test('long failing output keeps head, every early error window and the tail', () => {
  const words = ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'eta'];
  const lines = Array.from({ length: 2000 }, (_, i) => `line ${i} ${words[i % 7]} ${'x'.repeat(i % 5)}`);
  lines[500] = 'src/a.ts(12,5): error TS2322: Type string is not assignable to type number.';
  lines[900] = "src/b.ts(3,1): error TS2304: Cannot find name 'foo'.";
  const r = compress(lines.join('\n'), { exitCode: 2 });
  assert.match(r.text, /TS2322/);
  assert.match(r.text, /TS2304/);
  assert.match(r.text, /line 1999/);
  assert.ok(r.text.split('\n').length <= 85);
});

test('distinct error lines are never collapsed as "similar"', () => {
  const raw = Array.from({ length: 10 }, (_, i) => `src/x.ts(${i + 1},1): error TS2304: Cannot find name 'v${i}'.`).join('\n');
  const r = compress(raw, { exitCode: 1 });
  for (let i = 0; i < 10; i++) assert.match(r.text, new RegExp(`'v${i}'`));
});
