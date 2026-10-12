import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from './budget.mjs';

// One-command health check of an installed repo. It runs the real hook
// commands from .github/hooks/tokenkit.json through the platform shell (as a
// Node-based harness like VS Code does) with sample payloads, using a temporary
// log folder so the repo's statistics stay clean.

const EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse'];

export function doctor(root) {
  const rows = [];
  const ok = (msg) => rows.push(['ok', msg]);
  const warn = (msg) => rows.push(['warn', msg]);
  const fail = (msg) => rows.push(['FAIL', msg]);

  const major = Number(process.versions.node.split('.')[0]);
  (major >= 18 ? ok : fail)(`Node ${process.version} (needs 18 or later)`);

  const kit = join(root, '.tokenkit');
  const parts = ['tk.mjs', 'hooks/guard.mjs', 'hooks/post.mjs', 'hooks/prompt.mjs', 'hooks/session.mjs'];
  const missing = parts.filter((p) => !existsSync(join(kit, p)));
  if (missing.length) fail(`runtime .tokenkit/ is missing ${missing.join(', ')}; re-run install`);
  else ok('runtime .tokenkit/ present');

  let hooks = null;
  try {
    hooks = JSON.parse(readFileSync(join(root, '.github/hooks/tokenkit.json'), 'utf8')).hooks;
    const absent = EVENTS.filter((e) => !hooks?.[e]?.length);
    if (absent.length) fail(`hook file lacks ${absent.join(', ')}; re-run install`);
    else ok(`hook file registers ${EVENTS.length} events`);
  } catch {
    fail('.github/hooks/tokenkit.json missing or invalid; re-run install');
  }

  if (hooks && !missing.length) {
    const logs = mkdtempSync(join(tmpdir(), 'tk-doctor-'));
    // Each hook gets its own timeoutSec, as in VS Code, which cancels a slow hook.
    const run = (event, payload) => {
      const { command, timeoutSec = 30 } = hooks[event][0];
      const started = Date.now();
      const r = spawnSync(command, {
        cwd: root, shell: true, encoding: 'utf8', timeout: timeoutSec * 1000,
        input: JSON.stringify({ cwd: root, ...payload }), env: { ...process.env, TOKENKIT_LOG_DIR: logs }
      });
      let out = null;
      try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch { /* not JSON */ }
      return { status: r.status, out, stderr: (r.stderr || '').trim().split('\n')[0], ms: Date.now() - started, limit: timeoutSec, timedOut: r.error?.code === 'ETIMEDOUT' };
    };

    const lock = run('preToolUse', { hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { filePath: 'package-lock.json' } });
    if (lock.status === 0 && lock.out?.hookSpecificOutput?.permissionDecision === 'deny') ok('guard hook runs and blocks a lockfile read');
    else fail(`guard hook did not block a lockfile read (exit ${lock.status}${lock.stderr ? `: ${lock.stderr}` : ''})`);

    const t = run('preToolUse', { hook_event_name: 'PreToolUse', tool_name: 'run_in_terminal', tool_input: { command: 'npm test', explanation: 'x', mode: 'sync' } });
    const upd = t.out?.hookSpecificOutput?.updatedInput?.command ?? '';
    if (/tk\.mjs" run --shell \w+ -- npm test$/.test(upd)) ok('guard hook routes `npm test` through tk run');
    else if (t.out?.hookSpecificOutput?.permissionDecision === 'deny') ok('guard hook routes `npm test` through tk run (deny mode)');
    else fail('guard hook did not route `npm test` through tk run');

    // The session and prompt hooks rebuild a stale map: age it first, so the
    // timing below is the slow case VS Code will see, not the cheap one.
    const mapFile = join(kit, 'repomap.md');
    for (const [event, payload, stale] of [
      ['userPromptSubmitted', { hook_event_name: 'UserPromptSubmit', prompt: 'doctor check' }, true],
      ['postToolUse', { hook_event_name: 'PostToolUse', tool_name: 'run_in_terminal', tool_input: { command: 'echo hi' }, tool_response: 'hi' }, false],
      ['sessionStart', { hook_event_name: 'SessionStart' }, true]
    ]) {
      if (stale && existsSync(mapFile)) { const old = new Date(Date.now() - 86_400_000); utimesSync(mapFile, old, old); }
      const r = run(event, payload);
      const timing = `${(r.ms / 1000).toFixed(1)}s of its ${r.limit}s limit${stale ? ', refreshing a stale map' : ''}`;
      if (r.timedOut) fail(`${event} hook timed out (${timing}); VS Code cancels it too. Exclude bulky folders with map.exclude in .tokenkit/config.json`);
      else if (r.status !== 0) fail(`${event} hook runs (exit ${r.status}${r.stderr ? `: ${r.stderr}` : ''})`);
      else if (r.ms > r.limit * 500) warn(`${event} hook is slow (${timing}); exclude bulky folders with map.exclude`);
      else ok(`${event} hook runs (${timing})`);
    }
  }

  // Hooks fail open, so their errors only show up in this log.
  let errorLog = '';
  try { errorLog = readFileSync(join(kit, 'logs', 'errors.jsonl'), 'utf8'); } catch { /* no errors logged */ }
  const errors = errorLog.split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && Date.parse(e.ts) > Date.now() - 7 * 86_400_000);
  if (errors.length) warn(`${errors.length} hook error(s) in the last 7 days; latest: ${String(errors.at(-1).error).split('\n')[0]} (.tokenkit/logs/errors.jsonl)`);

  const ins = existsSync(join(root, '.github/copilot-instructions.md')) ? readFileSync(join(root, '.github/copilot-instructions.md'), 'utf8') : '';
  (ins.includes('<!-- tokenkit:start -->') ? ok : fail)('tokenkit block in .github/copilot-instructions.md');

  const map = join(kit, 'repomap.md');
  if (existsSync(map)) {
    const n = /· (\d+) source files · ~(\S+) tokens/.exec(readFileSync(map, 'utf8').split('\n', 1)[0]);
    const big = existsSync(join(kit, 'areas.md')) ? '; grep-only, folder overview in .tokenkit/areas.md' : '';
    ok(`repo map present (${n ? `${n[1]} source files, ~${n[2]} tokens` : 'old format; run: node .tokenkit/tk.mjs map'}${big})`);
  } else warn('repo map missing; run: node .tokenkit/tk.mjs map (the session hook also builds it)');

  const gi = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : '';
  (gi.includes('.tokenkit/logs/') ? ok : warn)('.gitignore keeps .tokenkit/logs/ out of git');

  try {
    execFileSync('git', ['check-ignore', '-q', '.tokenkit/tk.mjs'], { cwd: root, stdio: 'ignore' });
    warn('.tokenkit/ is git-ignored; teammates and the cloud agent will not get the runtime (hooks then do nothing)');
  } catch (e) {
    if (e.status === 1) ok('.tokenkit/ will be committed with the repo');
    else warn('not a git repo (or git missing): commit .github/ and .tokenkit/ once it is');
  }

  const vs = join(root, '.vscode/settings.json');
  if (existsSync(vs)) {
    const text = readFileSync(vs, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const key of ['chat.useHooks', 'chat.useAgentSkills']) {
      if (new RegExp(`"${key.replace('.', '\\.')}"\\s*:\\s*false`).test(text)) fail(`.vscode/settings.json sets ${key} to false`);
    }
    if (!/"chat\.tools\.compressOutput\.enabled"\s*:\s*true/.test(text)) warn('optional: add "chat.tools.compressOutput.enabled": true to .vscode/settings.json');
  }

  const b = audit(root);
  (b.total <= b.budget ? ok : warn)(`always-on context ~${b.total} tokens (budget ${b.budget})`);

  return { rows, failed: rows.some(([s]) => s === 'FAIL') };
}

export function formatDoctor(root, r) {
  return [
    `tokenkit doctor: ${root}`,
    ...r.rows.map(([s, m]) => `  [${s}]${' '.repeat(5 - s.length)}${m}`),
    '',
    r.failed ? 'Some checks FAILED; fix them, then run doctor again.' : 'All local checks passed.',
    'Only VS Code can confirm the rest: Workspace Trust, your org\'s hook policy, and "Chat: Configure Hooks" (docs/INSTALL.md, step 7).'
  ].join('\n');
}
