#!/usr/bin/env node
// postToolUse hook:
//  - logs every tool output's size (feeds `tk report`)
//  - Copilot CLI / cloud agent: replaces oversized output with a compressed
//    version via `modifiedResult`; the full text is saved for grepping.
//    (VS Code's PostToolUse cannot replace output; there it only logs.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compress } from '../lib/compress.mjs';
import { LOG_DIR, loadConfig } from '../lib/config.mjs';
import { commandMode, emitResult, isReadTool, isShellTool, logEvent, normalize, readPath, runHook, writeState } from '../lib/hookio.mjs';
import { classifyCommand } from '../lib/rules.mjs';
import { estimateTokens, fmtTokens } from '../lib/tokens.mjs';

const NEVER_TRIM = /view|read|edit|create|write|str_replace|apply_patch|insert|todo|task|skill|ask/i;

function headTail(text, head, tail) {
  const lines = text.split('\n');
  if (lines.length <= head + tail + 1) return text;
  return [...lines.slice(0, head), `… [${lines.length - head - tail} line(s) omitted]`, ...lines.slice(-tail)].join('\n');
}

runHook(async (payload) => {
  const ev = normalize(payload);
  if (!ev.output) return;
  const cfg = loadConfig().post;
  const tokens = estimateTokens(ev.output.text);
  const shell = isShellTool(ev);
  const target = shell ? ev.args.command : readPath(ev.args) ?? ev.args.pattern ?? ev.args.query ?? '';
  const record = { tool: ev.tool, target: String(target).slice(0, 160), tokens };

  // VS Code with guard.commands = "rewrite": if a verbose command ran without
  // tk's header, this harness ignored updatedInput, so switch the guard to deny.
  if (!ev.camel && shell && !ev.args.isBackground && commandMode(loadConfig().guard, ev) === 'rewrite'
      && classifyCommand(ev.args.command).kind === 'verbose' && !/^\[tk\] /m.test(ev.output.text)) {
    writeState({ localRewriteIgnored: true, detectedAt: new Date().toISOString() });
    logEvent('guard.jsonl', { action: 'fallback', rule: 'rewrite-ignored', tool: ev.tool, target: String(target).slice(0, 160) });
  }

  const eligible = ev.camel && ev.output.type === 'success' && tokens > cfg.minTokens
    && !isReadTool(ev) && !NEVER_TRIM.test(ev.tool) && !/tokenkit[\\/]tk\.mjs/.test(String(target));
  if (!eligible) return logEvent('tools.jsonl', record);

  let text;
  if (shell) {
    const m = /exit(?:ed with)? code:?\s*(-?\d+)/i.exec(ev.output.text.slice(-300));
    text = compress(ev.output.text, { ...loadConfig().run, exitCode: m ? Number(m[1]) : 1 }).text;
  } else {
    text = headTail(ev.output.text, cfg.otherHead, cfg.otherTail);
  }
  const kept = estimateTokens(text);
  if (kept >= tokens * 0.8) return logEvent('tools.jsonl', record);

  mkdirSync(LOG_DIR, { recursive: true });
  const file = `tool-${Date.now()}.log`;
  writeFileSync(join(LOG_DIR, file), ev.output.text);
  logEvent('tools.jsonl', { ...record, keptTokens: kept });
  emitResult(`[tk] output compressed ~${fmtTokens(tokens)}→${fmtTokens(kept)} tokens · full: .tokenkit/logs/${file} (grep it; don't read it whole)\n${text}`);
});
