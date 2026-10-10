import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compress } from './compress.mjs';
import { LOG_DIR, loadConfig } from './config.mjs';
import { fmtTokens } from './tokens.mjs';

// Quote argv back into one shell string. A single argument is passed through
// untouched so callers can write: tk run "pytest -k 'a and b'".
export function joinArgs(args) {
  if (args.length === 1) return args[0];
  return args.map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`)).join(' ');
}

function rotate(keep) {
  const files = readdirSync(LOG_DIR).filter((f) => /^run-.*\.log$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try { unlinkSync(join(LOG_DIR, f)); } catch { /* in use */ }
  }
}

// The guard hook passes the shell the agent's tool would have used, so the
// command keeps its syntax (PowerShell vs bash). Default: platform shell.
function spawnIn(shell, cmd, env) {
  if (shell === 'bash') return spawn('bash', ['-c', cmd], { env });
  if (shell === 'powershell') {
    const exe = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    return spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', cmd], { env });
  }
  return spawn(cmd, { shell: true, env });
}

export function runCommand(args, { raw = false, shell } = {}) {
  const cfg = loadConfig().run;
  const cmd = joinArgs(args);
  if (!cmd) {
    console.error('usage: tk run [--raw] -- <command ...>');
    return Promise.resolve(2);
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawnIn(shell, cmd, { ...process.env, CI: process.env.CI ?? '1', FORCE_COLOR: '0', NO_COLOR: '1' });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    let timedOut = false;
    const timer = cfg.timeoutSec > 0 && setTimeout(() => { timedOut = true; child.kill(); }, cfg.timeoutSec * 1000);

    const finish = (code) => {
      if (timer) clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      const exitCode = timedOut ? 124 : code ?? 1;

      mkdirSync(LOG_DIR, { recursive: true });
      const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
      const logName = `run-${stamp}.log`;
      const body = `$ ${cmd}\n# exit ${exitCode}\n${output}`;
      writeFileSync(join(LOG_DIR, logName), body);
      writeFileSync(join(LOG_DIR, 'last.log'), body);
      rotate(cfg.keepLogs);

      if (raw) {
        process.stdout.write(output);
        return resolve(exitCode);
      }

      const r = compress(output, { ...cfg, exitCode });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const status = exitCode === 0 ? 'OK' : timedOut ? `TIMEOUT after ${cfg.timeoutSec}s` : `FAILED exit ${exitCode}`;
      const saved = r.stats.rawTokens > r.stats.keptTokens
        ? ` · ${r.stats.rawLines}→${r.stats.keptLines} lines, ~${fmtTokens(r.stats.rawTokens)}→${fmtTokens(r.stats.keptTokens)} tokens`
        : '';
      const lines = [`[tk] ${status} in ${secs}s${saved} · full log: .tokenkit/logs/last.log`];
      if (r.notes.length) lines.push(`[tk] ${r.notes.join('; ')}`);
      if (r.text) lines.push(r.text);
      process.stdout.write(lines.join('\n') + '\n');

      try {
        appendFileSync(join(LOG_DIR, 'runs.jsonl'), JSON.stringify({
          ts: new Date().toISOString(), cmd, exitCode, ms: Date.now() - started,
          rawTokens: r.stats.rawTokens, keptTokens: r.stats.keptTokens
        }) + '\n');
      } catch { /* stats are best-effort */ }
      resolve(exitCode);
    };
    child.on('error', (e) => { chunks.push(Buffer.from(String(e.message))); finish(127); });
    child.on('close', finish);
  });
}
