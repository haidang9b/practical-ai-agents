import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from './config.mjs';

// Copilot sends two payload shapes to the same hook command:
//  - camelCase events (Copilot CLI / cloud agent / VS Code Copilot harness):
//      { toolName, toolArgs (object or JSON string), toolResult: { resultType, textResultForLlm } }
//  - PascalCase events (VS Code / Claude-style):
//      { hook_event_name, tool_name, tool_input, tool_response }
// normalize() hides the difference; the emit helpers answer in both dialects.

export async function readPayload() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

export function normalize(p) {
  const camel = 'toolName' in p || 'toolArgs' in p;
  let raw = camel ? p.toolArgs : p.tool_input;
  const argsWereString = typeof raw === 'string';
  let args = raw ?? {};
  if (argsWereString) { try { args = JSON.parse(raw); } catch { args = { command: raw }; } }
  let output;
  if (camel && p.toolResult) output = { type: p.toolResult.resultType, text: p.toolResult.textResultForLlm ?? '' };
  else if (p.tool_response !== undefined) output = { type: 'success', text: typeof p.tool_response === 'string' ? p.tool_response : JSON.stringify(p.tool_response) };
  return { camel, tool: String(p.toolName ?? p.tool_name ?? ''), args, argsWereString, output, cwd: p.cwd || process.cwd() };
}

export const isShellTool = (ev) => typeof ev.args.command === 'string' && /bash|shell|powershell|terminal|command|exec/i.test(ev.tool);
export const isReadTool = (ev) => /^(view|read|read_?file|readfile|open_?file|get_?file)/i.test(ev.tool);
export const readPath = (args) => args.path ?? args.filePath ?? args.file_path ?? args.file ?? args.uri ?? null;
export const hasRange = (args) => ['view_range', 'startLine', 'endLine', 'start_line', 'end_line', 'offset', 'limit', 'lineStart', 'range']
  .some((k) => args[k] !== undefined && args[k] !== null);

export function emitDeny(reason) {
  process.stdout.write(JSON.stringify({
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
  }));
}

// No permissionDecision here on purpose: the user's normal approval flow for
// the (rewritten) command still applies.
export function emitRewrite(ev, newArgs) {
  process.stdout.write(JSON.stringify({
    modifiedArgs: ev.argsWereString ? JSON.stringify(newArgs) : newArgs,
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: newArgs }
  }));
}

export function emitResult(text) {
  process.stdout.write(JSON.stringify({ modifiedResult: { resultType: 'success', textResultForLlm: text } }));
}

export function logEvent(file, record) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, file), JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
  } catch { /* logging must never break the agent */ }
}

// Small persisted facts learned at runtime (e.g. "this harness ignores updatedInput").
export function readState() {
  try { return JSON.parse(readFileSync(join(LOG_DIR, 'state.json'), 'utf8')); } catch { return {}; }
}
export function writeState(patch) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(join(LOG_DIR, 'state.json'), JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch { /* best-effort */ }
}

// Which command mode applies to this harness. Both VS Code (updatedInput,
// verified in VS Code 1.141 / Copilot Chat 0.69) and Copilot CLI (modifiedArgs)
// apply rewrites; if a VS Code build silently drops them, post.mjs notices the
// missing "[tk]" header and this falls back to deny.
export function commandMode(guard, ev) {
  let mode = guard.commands;
  if (mode === 'auto') mode = 'rewrite';
  if (mode === 'rewrite' && !ev.camel && readState().localRewriteIgnored) mode = 'deny';
  return mode;
}

// Hooks must fail open: a crash here should never block the agent.
export async function runHook(fn) {
  try {
    await fn(await readPayload());
  } catch (e) {
    logEvent('errors.jsonl', { error: String(e && e.stack || e) });
  }
  // Set, don't call exit(): stdout may still be flushing to a pipe.
  process.exitCode = 0;
}
