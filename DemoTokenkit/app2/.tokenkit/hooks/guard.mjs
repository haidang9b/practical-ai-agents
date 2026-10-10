#!/usr/bin/env node
// preToolUse hook: keeps oversized output out of the context window.
//  - verbose build/test/install commands -> rewritten to run through `tk run`
//      (VS Code: hookSpecificOutput.updatedInput; Copilot CLI: modifiedArgs),
//      or denied with the exact re-run command in deny mode / fallback
//  - unbounded git log / recursive listings / container logs -> denied with a bounded alternative
//  - lockfiles, generated/minified files, huge whole-file reads -> denied with a hint
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { KIT_DIR, loadConfig } from '../lib/config.mjs';
import { commandMode, emitDeny, emitRewrite, hasRange, isReadTool, isShellTool, logEvent, normalize, readPath, runHook } from '../lib/hookio.mjs';
import { blockedPath, classifyCommand, wrapCommand } from '../lib/rules.mjs';

const DIFF_LINE_LIMIT = 400;

function sizeKB(cwd, p) {
  try {
    const s = statSync(isAbsolute(p) ? p : join(cwd, p));
    return s.isFile() ? s.size / 1024 : 0;
  } catch { return 0; }
}

// For `git diff`/`git show`, measure first and only block genuinely large ones.
function diffTooLarge(cmd, cwd) {
  const m = /^\s*git\s+(diff|show)\b(.*)$/.exec(cmd);
  if (!m || /[;&|]/.test(cmd)) return false;
  try {
    const args = [m[1], '--shortstat', ...m[2].trim().split(/\s+/).filter(Boolean)];
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const n = [...out.matchAll(/(\d+) (insertion|deletion)/g)].reduce((a, x) => a + Number(x[1]), 0);
    return n > DIFF_LINE_LIMIT ? n : false;
  } catch { return false; }
}

function shellFor(ev, configured) {
  if (configured && configured !== 'auto') return configured;
  if (/powershell|pwsh/i.test(ev.tool)) return 'powershell';
  if (/bash/i.test(ev.tool)) return 'bash';
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

runHook(async (payload) => {
  const ev = normalize(payload);
  const g = loadConfig().guard;
  const kit = KIT_DIR.replace(/\\/g, '/');

  if (isShellTool(ev)) {
    const cmd = ev.args.command;
    if (ev.args.isBackground || /^(async|detached)$/.test(ev.args.mode ?? '')) return;
    const c = classifyCommand(cmd);

    if (c.kind === 'unbounded' && g.bounded === 'deny') {
      if (c.soft) {
        const n = diffTooLarge(cmd, ev.cwd);
        if (!n) return;
        c.hint = `This diff is ${n} changed lines. ${c.hint}`;
      }
      logEvent('guard.jsonl', { action: 'deny', rule: 'unbounded', tool: ev.tool, target: cmd.slice(0, 160) });
      return emitDeny(`[tokenkit] ${c.hint}`);
    }

    if (c.kind === 'read' && g.reads === 'deny') {
      const bounded = /^\s*(head|tail)\b|-(TotalCount|Tail|Head|First)\b/i.test(cmd);
      for (const p of c.paths) {
        const rule = blockedPath(p, g);
        const kb = sizeKB(ev.cwd, p);
        if (rule || (!bounded && kb > g.maxReadKB)) {
          logEvent('guard.jsonl', { action: 'deny', rule: rule ? 'blocked-path' : 'large-read', tool: ev.tool, target: p, kb: Math.round(kb) });
          return emitDeny(rule
            ? `[tokenkit] ${p} is a lockfile/generated/binary file; reading it wastes context. Grep it for the exact entry you need instead.`
            : `[tokenkit] ${p} is ${Math.round(kb)} KB. Grep for the symbol, then read only the needed line range (e.g. sed -n '120,180p' / Get-Content | Select-Object -Skip 119 -First 60).`);
        }
      }
      return;
    }

    if (c.kind === 'suspicious') {
      logEvent('guard.jsonl', { action: 'deny', rule: 'suspicious-wrapper', tool: ev.tool, target: c.inner.slice(0, 160) });
      return emitDeny('[tokenkit] This tk --b64 wrapper does not match a build/test command (or its comment). Run the command in plain text so it can be reviewed.');
    }

    const mode = commandMode(g, ev);
    if (c.kind === 'verbose' && mode !== 'off') {
      const shell = shellFor(ev, g.shell);
      if (mode === 'deny') {
        // Relative path when the terminal starts at the repo root: shorter and readable at approval time.
        const rel = relative(ev.cwd, KIT_DIR).replace(/\\/g, '/');
        const ref = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : kit;
        logEvent('guard.jsonl', { action: 'deny', rule: 'verbose', tool: ev.tool, target: cmd.slice(0, 160) });
        return emitDeny(`[tokenkit] Re-run through the output compressor (same command, compact output, full log kept): ${wrapCommand(cmd, shell, ref)}`);
      }
      logEvent('guard.jsonl', { action: 'rewrite', rule: 'verbose', tool: ev.tool, target: cmd.slice(0, 160) });
      return emitRewrite(ev, { ...ev.args, command: wrapCommand(cmd, shell, kit) });
    }
    return;
  }

  if (isReadTool(ev) && g.reads === 'deny') {
    const p = readPath(ev.args);
    if (!p) return;
    const rel = isAbsolute(p) ? relative(ev.cwd, p) : p;
    const rule = blockedPath(rel, g);
    const kb = sizeKB(ev.cwd, p);
    if (rule) {
      logEvent('guard.jsonl', { action: 'deny', rule: 'blocked-path', tool: ev.tool, target: rel });
      return emitDeny(`[tokenkit] ${rel} is a lockfile/generated/build artifact; don't read it. Grep it for the exact entry you need, or read the source that produces it.`);
    }
    if (!hasRange(ev.args) && kb > g.maxReadKB) {
      logEvent('guard.jsonl', { action: 'deny', rule: 'large-read', tool: ev.tool, target: rel, kb: Math.round(kb) });
      return emitDeny(`[tokenkit] ${rel} is ${Math.round(kb)} KB. Find the relevant symbol first (grep, or .tokenkit/repomap.md has Symbol:line), then read only that line range.`);
    }
  }
});
