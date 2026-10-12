import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { audit } from '../src/lib/budget.mjs';
import { mergeBlock } from '../src/lib/install.mjs';
import { expandSpec, FLAGS, LEGEND, parseSpec } from '../src/lib/spec.mjs';
import { detectChecks } from '../src/lib/verify.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TK = join(ROOT, 'src', 'tk.mjs');
const LOGS = mkdtempSync(join(tmpdir(), 'tk-logs-'));
const tk = (args, opts = {}) => spawnSync(process.execPath, [TK, ...args], {
  encoding: 'utf8', env: { ...process.env, TOKENKIT_LOG_DIR: LOGS }, ...opts
});

test('tk run propagates the exit code and compresses output', () => {
  const script = "for(let i=0;i<500;i++)console.log('PASS t'+i);console.error('Error: kaboom at x.js:3');process.exit(3)";
  const r = tk(['run', '--', process.execPath, '-e', script]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /FAILED exit 3/);
  assert.match(r.stdout, /Error: kaboom/);
  assert.match(r.stdout, /500 passing-test line/);
  assert.ok(r.stdout.split('\n').length < 10);
  assert.match(readFileSync(join(LOGS, 'last.log'), 'utf8'), /PASS t499/);
});

test('tk run --b64 runs the decoded command', () => {
  const cmd = `"${process.execPath}" -e "console.log('a b'); process.exit(0)"`;
  const r = tk(['run', '--b64', Buffer.from(cmd).toString('base64')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK in/);
  assert.match(r.stdout, /a b/);
});

test('tk filter compresses stdin', () => {
  const input = Array.from({ length: 300 }, (_, i) => `  ✓ case ${i}`).join('\n') + '\nerror: one failed\n';
  const r = tk(['filter'], { input });
  assert.match(r.stdout, /error: one failed/);
  assert.match(r.stdout, /300 passing-test/);
});

test('TaskSpec parses scopes and flags and expands deterministically', () => {
  const s = parseSpec('fix @src/a.ts:10-20 @lib/b.py#load "null user crashes" +test >diff ^bogus');
  assert.equal(s.verb, 'fix');
  assert.deepEqual(s.scopes[0], { path: 'src/a.ts', start: 10, end: 20, symbol: undefined });
  assert.equal(s.scopes[1].symbol, 'load');
  assert.equal(s.goal, 'null user crashes');
  assert.deepEqual(s.flags, ['+test', '>diff']);
  assert.deepEqual(s.unknown, ['^bogus']);
  const { text } = expandSpec('review @src/x.ts >ans', ROOT);
  assert.match(text, /^Task: Review and list concrete issues \(no edits\): \(see scope\)/);
  assert.match(text, /Output: answer in at most 5 lines/);
});

test('TaskSpec resolves #Symbol to a line range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-spec-'));
  writeFileSync(join(dir, 'a.ts'), 'export function one() {\n}\n\nexport function two() {\n  return 2;\n}\n');
  assert.match(expandSpec('fix @a.ts#two off by one', dir).text, /a\.ts lines 4-7 \(two\)/);
});

test('the /spec prompt carries the current legend and every flag', () => {
  const tpl = readFileSync(join(ROOT, 'templates', '.github', 'prompts', 'spec.prompt.md'), 'utf8');
  assert.ok(tpl.includes(LEGEND), 'legend out of date: regenerate with `tk spec --legend` into templates/.github/prompts/spec.prompt.md');
  for (const f of Object.keys(FLAGS)) assert.ok(tpl.includes(`\`${f}\``), f);
});

test('budget audit flags duplicates, broad applyTo, bad skill names and MCP sprawl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-budget-'));
  mkdirSync(join(dir, '.github', 'instructions'), { recursive: true });
  mkdirSync(join(dir, '.github', 'skills', 'my-skill'), { recursive: true });
  mkdirSync(join(dir, '.vscode'));
  const rule = '- Always use the repository logger instead of console output in services.';
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), `# Rules\n${rule}\n- Please make sure to write tests.\n`);
  writeFileSync(join(dir, 'AGENTS.md'), `# Agents\n${rule}\n`);
  writeFileSync(join(dir, '.github', 'instructions', 'all.instructions.md'), '---\napplyTo: "**"\n---\n- x\n');
  writeFileSync(join(dir, '.github', 'instructions', 'py.instructions.md'), '---\napplyTo: "**/*.py"\n---\n- y\n');
  writeFileSync(join(dir, '.github', 'skills', 'my-skill', 'SKILL.md'), '---\nname: other-name\ndescription: >\n  Does things.\n---\nbody\n');
  writeFileSync(join(dir, '.vscode', 'mcp.json'), '{ "servers": { "github": {}, "playwright": {} } }');
  const r = audit(dir);
  const f = r.findings.join('\n');
  assert.match(f, /are all loaded together/);
  assert.match(f, /repeats a line/);
  assert.match(f, /filler "Please"/i);
  assert.match(f, /effectively always-on/);
  assert.match(f, /must equal the folder name/);
  assert.match(f, /2 MCP server/);
  assert.ok(r.onDemand.some((o) => o.label.endsWith('py.instructions.md')));
  assert.ok(r.always.some((a) => a.label.startsWith('skill my-skill')));
});

test('install is idempotent, merges instructions and never clobbers user files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-install-'));
  mkdirSync(join(dir, '.github'));
  mkdirSync(join(dir, '.vscode'));
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# Team rules\n- Use pnpm.\n');
  writeFileSync(join(dir, '.vscode', 'settings.json'), '{ "editor.tabSize": 2 }');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(dir, 'app.py'), 'def main():\n    pass\n');
  for (let i = 0; i < 2; i++) {
    const r = tk(['install', dir]);
    assert.equal(r.status, 0, r.stderr);
  }
  const ins = readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf8');
  assert.match(ins, /^# Team rules\n- Use pnpm\./);
  assert.equal(ins.split('<!-- tokenkit:start -->').length, 2, 'block merged exactly once');
  assert.equal(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'), '{ "editor.tabSize": 2 }');
  const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.equal(gi.split('.tokenkit/logs/').length, 2);
  for (const p of ['.tokenkit/tk.mjs', '.tokenkit/hooks/guard.mjs', '.github/hooks/tokenkit.json', '.github/skills/lean-explore/SKILL.md', '.github/agents/lean.agent.md']) {
    assert.ok(existsSync(join(dir, p)), p);
  }
  assert.match(readFileSync(join(dir, '.tokenkit', 'repomap.md'), 'utf8'), /app\.py \| main:1/);
  const b = spawnSync(process.execPath, [join(dir, '.tokenkit', 'tk.mjs'), 'budget', dir, '--ci'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stdout);
});

test('re-install upgrades untouched tokenkit files and keeps locally edited ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-upgrade-'));
  assert.equal(tk(['install', dir]).status, 0);
  const skill = join(dir, '.github', 'skills', 'lean-explore', 'SKILL.md');
  const agent = join(dir, '.github', 'agents', 'lean.agent.md');
  const tplSkill = readFileSync(skill, 'utf8');
  // Simulate an older tokenkit version: file content and manifest agree on "old".
  const manifestPath = join(dir, '.tokenkit', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(skill, 'old version\n');
  manifest['.github/skills/lean-explore/SKILL.md'] = createHash('sha256').update('old version\n').digest('hex').slice(0, 16);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  // And a user edit the manifest doesn't know about.
  writeFileSync(agent, 'my custom agent\n');
  const out = tk(['install', dir]).stdout;
  assert.match(out, /updated {3}\.github\/skills\/lean-explore\/SKILL\.md/);
  assert.match(out, /skipped {3}\.github\/agents\/lean\.agent\.md \(edited locally/);
  assert.equal(readFileSync(skill, 'utf8'), tplSkill);
  assert.equal(readFileSync(agent, 'utf8'), 'my custom agent\n');
});

test('doctor passes a healthy install and catches broken ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-doctor-'));
  writeFileSync(join(dir, 'app.js'), 'export function main() {}\n');
  assert.equal(tk(['install', dir]).status, 0);
  const doc = () => spawnSync(process.execPath, [join(dir, '.tokenkit', 'tk.mjs'), 'doctor', dir], { encoding: 'utf8' });
  const good = doc();
  assert.equal(good.status, 0, good.stdout);
  assert.match(good.stdout, /\[ok\] +guard hook runs and blocks a lockfile read/);
  assert.match(good.stdout, /\[ok\] +guard hook routes `npm test` through tk run/);

  writeFileSync(join(dir, '.vscode', 'settings.json'), '{ "chat.useHooks": false }');
  const off = doc();
  assert.equal(off.status, 1);
  assert.match(off.stdout, /\[FAIL\] .*chat\.useHooks to false/);

  writeFileSync(join(dir, '.vscode', 'settings.json'), '{}');
  rmSync(join(dir, '.tokenkit', 'hooks', 'guard.mjs'));
  const broken = doc();
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /\[FAIL\] runtime \.tokenkit\/ is missing hooks\/guard\.mjs/);
});

test('uninstall removes only what install added and keeps user content and edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-uninstall-'));
  mkdirSync(join(dir, '.github', 'skills', 'mine'), { recursive: true });
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# Team rules\n- Use pnpm.\n');
  writeFileSync(join(dir, '.github', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\ndescription: x\n---\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  assert.equal(tk(['install', dir]).status, 0);
  writeFileSync(join(dir, '.github', 'agents', 'lean.agent.md'), 'my edited agent\n');

  const dry = tk(['uninstall', dir, '--dry-run']);
  assert.match(dry.stdout, /DRY RUN/);
  assert.ok(existsSync(join(dir, '.tokenkit', 'tk.mjs')), 'dry run must not delete');

  // Run the repo's own copy: it removes the folder it runs from.
  const r = spawnSync(process.execPath, [join(dir, '.tokenkit', 'tk.mjs'), 'uninstall', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kept {6}\.github\/agents\/lean\.agent\.md \(edited locally/);
  assert.ok(!existsSync(join(dir, '.tokenkit')));
  assert.ok(!existsSync(join(dir, '.github', 'hooks')));
  assert.ok(!existsSync(join(dir, '.github', 'skills', 'lean-explore')));
  assert.ok(!existsSync(join(dir, '.github', 'prompts')));
  assert.ok(existsSync(join(dir, '.github', 'skills', 'mine', 'SKILL.md')), 'user skill kept');
  assert.equal(readFileSync(join(dir, '.github', 'agents', 'lean.agent.md'), 'utf8'), 'my edited agent\n');
  assert.equal(readFileSync(join(dir, '.github', 'copilot-instructions.md'), 'utf8'), '# Team rules\n- Use pnpm.\n');
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n');
});

test('regression: files added after install are mapped on the next prompt (was: empty map for an hour)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-stale-'));
  assert.equal(tk(['install', dir]).status, 0);
  assert.match(readFileSync(join(dir, '.tokenkit', 'repomap.md'), 'utf8'), /· 0 source files/);
  // The app is created after install, e.g. by the agent itself.
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'lib', 'taskStorage.ts'), 'export function loadTasks() {\n  return [];\n}\n\nexport function saveTasks(tasks: unknown[]) {\n}\n');
  const r = spawnSync(process.execPath, [join(dir, '.tokenkit', 'hooks', 'prompt.mjs')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'saved tasks disappear after reload', cwd: dir }),
    encoding: 'utf8', env: { ...process.env, TOKENKIT_LOG_DIR: mkdtempSync(join(tmpdir(), 'tk-stale-logs-')) }
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, '.tokenkit', 'repomap.md'), 'utf8'), /· 1 source files/);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /src\/lib\/taskStorage\.ts:\d+-\d+ {2}(saveTasks|loadTasks)/);
});

test('tk verify runs every check in one call and reports each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-verify-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {
    typecheck: 'node -e "console.log(1)"',
    lint: 'node -e "process.exit(3)"',
    test: 'node -e "for(let i=0;i<50;i++)console.log(String.fromCharCode(10003),String.fromCharCode(99,97,115,101),i)"',
    dev: 'vite --watch'
  } }));
  assert.equal(tk(['install', dir]).status, 0);
  const r = spawnSync(process.execPath, [join(dir, '.tokenkit', 'tk.mjs'), 'verify'], { encoding: 'utf8', env: { ...process.env, TOKENKIT_LOG_DIR: LOGS } });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /\[tk\] verify: typecheck OK · lint FAILED · test OK$/m);
  assert.doesNotMatch(r.stdout, /case 7/, 'passing output is not printed');
  assert.doesNotMatch(r.stdout, /dev/);
});

test('tk verify finds frontend and backend projects under src/ and --in narrows to one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-verify-multi-'));
  const put = (rel, body) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), body); };
  put('src/Frontend/package.json', JSON.stringify({ scripts: { lint: 'node -e "process.exit(0)"', test: 'node -e "require(\'fs\').accessSync(\'package.json\')"' } }));
  put('src/Frontend/src/features/cart/Cart.tsx', 'export function Cart() {}\n');
  put('src/Backend/Contoso.sln', '');
  put('src/Backend/Contoso.Api/Contoso.Api.csproj', '<Project />');
  put('tools/package.json', JSON.stringify({ workspaces: ['pkgs/*'], scripts: { test: 'node -e 0' } }));
  put('tools/pkgs/a/package.json', JSON.stringify({ scripts: { test: 'node -e 0' } }));
  const checks = detectChecks(dir).map((c) => `${c.name}=${c.cmd}`);
  assert.deepEqual(checks, [
    'src/Backend:build=dotnet build Contoso.sln -v q',
    'src/Backend:test=dotnet test Contoso.sln -v q --no-build',
    'src/Frontend:lint=npm run lint',
    'src/Frontend:test=npm run test',
    'tools:test=npm run test'
  ], 'one solution covers its projects; a workspace root covers its packages');

  assert.equal(tk(['install', dir]).status, 0);
  const verify = (...args) => spawnSync(process.execPath, [join(dir, '.tokenkit', 'tk.mjs'), 'verify', ...args], { encoding: 'utf8', env: { ...process.env, TOKENKIT_LOG_DIR: LOGS } });
  // A folder inside the frontend picks the frontend; its test only passes when run from src/Frontend.
  const r = verify('--in', 'src/Frontend/src/features');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\[tk\] verify: src\/Frontend:lint OK · src\/Frontend:test OK$/m);
  assert.equal(verify('--in', 'docs').status, 2);
});

test('re-install retires files an older tokenkit installed and keeps edited ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-retire-'));
  assert.equal(tk(['install', dir]).status, 0);
  // Pretend an older version installed two skills that no longer ship.
  const old = (rel, body) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), body); return body; };
  const manifestPath = join(dir, '.tokenkit', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  manifest['.github/skills/handoff/SKILL.md'] = h(old('.github/skills/handoff/SKILL.md', 'old skill\n'));
  manifest['.github/skills/context-audit/SKILL.md'] = h('original\n');
  old('.github/skills/context-audit/SKILL.md', 'my edits\n');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const out = tk(['install', dir]).stdout;
  assert.match(out, /retired {3}\.github\/skills\/handoff\/SKILL\.md/);
  assert.match(out, /kept {6}\.github\/skills\/context-audit\/SKILL\.md \(no longer part of tokenkit, but edited locally\)/);
  assert.ok(!existsSync(join(dir, '.github', 'skills', 'handoff')));
  assert.equal(readFileSync(join(dir, '.github', 'skills', 'context-audit', 'SKILL.md'), 'utf8'), 'my edits\n');
});

test('mergeBlock replaces an existing block in place', () => {
  const tpl = 'x\n<!-- tokenkit:start -->\nNEW\n<!-- tokenkit:end -->\n';
  const cur = 'a\n<!-- tokenkit:start -->\nOLD\n<!-- tokenkit:end -->\nb\n';
  assert.equal(mergeBlock(cur, tpl), 'a\n<!-- tokenkit:start -->\nNEW\n<!-- tokenkit:end -->\nb\n');
});
