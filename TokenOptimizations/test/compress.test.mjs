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

// Varied log lines, so nothing collapses and the output really is long.
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const appLogs = (n, o = 0) => range(n, (i) => [`info: Orders[0] Processing order ${i + o}`, `dbug: EF[20101] Executed DbCommand (${i}ms)`,
  `info: Billing[0] Invoice INV-${i + o} queued`, `info: Lifetime[0] Heartbeat ${i + o}`][i % 4]);

test('regression: a failing C# test keeps its file:line and Actual value in long output', () => {
  const fail = (name, line, act) => [`  Failed Contoso.Tests.OrderTests.${name} [12 ms]`, '  Error Message:', '   Assert.Equal() Failure: Values differ',
    '   Expected: 90', `   Actual:   ${act}`, '  Stack Trace:', `     at Contoso.Tests.OrderTests.${name}() in D:\\src\\Tests\\OrderTests.cs:line ${line}`,
    '     at System.RuntimeMethodHandle.InvokeMethod(Object target, Void** arguments)'];
  const raw = [...appLogs(300), ...fail('Discount', 42, 81), ...appLogs(300, 300), ...fail('Refund', 77, 4), ...appLogs(300, 600),
    'Failed!  - Failed:     2, Passed:   800, Skipped:     0, Total:   802'].join('\n');
  const r = compress(raw, { exitCode: 1 });
  for (const s of ['OrderTests.cs:line 42', 'Actual:   81', 'OrderTests.cs:line 77', 'Actual:   4', 'Failed:     2']) assert.ok(r.text.includes(s), s);
  assert.doesNotMatch(r.text, /RuntimeMethodHandle/);
});

test('regression: each failing jest test keeps its file:line, even many rows below the error', () => {
  const raw = ['> jest', ...range(12, (k) => [...range(40, (i) => `PASS src/m${k}_${i}.test.tsx`), `FAIL src/cart${k}.test.tsx`, `  ● cart › total ${k}`, '',
    `    Expected: ${k}`, `    Received: ${k + 1}`, '', `    > ${11 + k} |   expect(c.total()).toBe(${k});`, '         |   ^', '',
    `      at Object.<anonymous> (src/cart${k}.test.tsx:${11 + k}:21)`, '      at Promise.then.completed (node_modules/jest-circus/build/utils.js:298:28)', '']).flat(),
  'Tests:       12 failed, 480 passed, 492 total'].join('\n');
  const r = compress(raw, { exitCode: 1 });
  for (let k = 0; k < 12; k++) {
    assert.ok(r.text.includes(`cart${k}.test.tsx:${11 + k}:21`), `location of test ${k}`);
    assert.ok(r.text.includes(`Received: ${k + 1}`), `received of test ${k}`);
  }
});

test('regression: an error overwritten by a carriage-return progress update is kept', () => {
  const raw = [...range(300, (i) => `step ${i} done`), 'error: EADDRINUSE: address already in use :::5173\r  building... 40%', ...range(300, (i) => `cleanup ${i}`)].join('\n');
  assert.match(compress(raw, { exitCode: 1 }).text, /EADDRINUSE/);
});

test('every distinct error is kept up to maxErrorLines, past the line cap', () => {
  const raw = range(150, (i) => `src/f${i % 30}/Item${i}.tsx(${i + 3},9): error TS2304: Cannot find name 'OrderDto${i}'.`).join('\n') + '\n\nFound 150 errors in 150 files.';
  const r = compress(raw, { exitCode: 1 });
  for (let i = 0; i < 150; i++) assert.ok(r.text.includes(`'OrderDto${i}'`), `error ${i}`);
  const tight = compress(raw, { exitCode: 1, maxErrorLines: 40 });
  assert.match(tight.notes.join('; '), /\d+ more error line\(s\) not shown \(TS2304 ×\d+\) in \d+ file\(s\); grep the log/);
});

test('MSBuild\'s repeated error summary is shown once, warnings are summarized by code', () => {
  const errs = range(30, (i) => `D:\\src\\Billing\\Invoice${i}.cs(${10 + i},17): error CS0103: The name 'item${i}' does not exist in the current context [D:\\src\\Billing\\Billing.csproj]`);
  const warns = range(60, (i) => `D:\\src\\Billing\\Dto${i}.cs(5,23): warning CS8618: Non-nullable property 'Name' is uninitialized. [D:\\src\\Billing\\Billing.csproj]`);
  const r = compress([...warns, ...errs, 'Build FAILED.', ...warns, ...errs, '    60 Warning(s)', '    30 Error(s)'].join('\n'), { exitCode: 1 });
  for (let i = 0; i < 30; i++) assert.equal(r.text.split(`'item${i}'`).length - 1, 1, `item${i} shown exactly once`);
  assert.match(r.notes.join('; '), /30 repeated error line\(s\) shown once/);
  assert.match(r.notes.join('; '), /60 warning line\(s\) in full log \(CS8618 ×60\)/);
  assert.match(r.text, /30 Error\(s\)/);
});

test('one error repeated in hundreds of files is folded; a different error among them survives', () => {
  const lines = range(2000, (i) => `src/Billing/F${i % 300}.cs(${i + 1},5): error CS0246: The type or namespace name 'OrderDto' could not be found [Billing.csproj]`);
  lines.splice(1500, 0, "src/Api/Startup.cs(12,9): error CS1061: 'IServiceCollection' does not contain a definition for 'AddBilling'");
  const r = compress(lines.join('\n'), { exitCode: 1 });
  assert.match(r.text, /AddBilling/);
  assert.match(r.notes.join('; '), /same error at \d+ more location\(s\) in \d+ file\(s\): "error CS0246: The type or namespace name 'OrderDto' could not be found"/);
  assert.ok(r.stats.keptTokens < r.stats.rawTokens / 10, `${r.stats.keptTokens} of ${r.stats.rawTokens}`);
});

test('a long Python traceback keeps the exception line and the frames nearest to it', () => {
  const raw = [...appLogs(200), 'Traceback (most recent call last):',
    ...range(12, (i) => [`  File "/app/svc/step${i}.py", line ${i + 1}, in step${i}`, `    step${i + 1}()`]).flat(),
    '  File "/app/svc/pricing.py", line 88, in recalc', '    raise ValueError("negative total")', 'ValueError: negative total', ...appLogs(200, 200)].join('\n');
  const r = compress(raw, { exitCode: 1 });
  assert.match(r.text, /ValueError: negative total/);
  assert.match(r.text, /pricing\.py", line 88/);
});
