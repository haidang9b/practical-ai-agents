import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from './tokens.mjs';

// Reads VS Code's own chat-session logs for a workspace folder, so two repos
// (with and without tokenkit) can be compared on the same yardstick. The file
// format is internal to VS Code; this is best-effort and prints numbers only.

const TOOL_GROUPS = [
  ['terminal', /terminal|run_in_terminal|kill_terminal|get_terminal_output|runTests|run_task|create_and_run_task/i],
  ['browser', /page|browser|click_element|type_in_page|playwright|screenshot/i],
  ['read', /readFile|read_file|getErrors|get_errors|problems|readNotebook/i],
  ['search', /find|search|listDirectory|list_dir|codebase|usages/i],
  ['edit', /applyPatch|edit|createFile|create_file|insert|replace/i]
];
const groupOf = (id) => (TOOL_GROUPS.find(([, re]) => re.test(id)) || ['other'])[0];

function userDirs() {
  const base = process.platform === 'win32' ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config');
  return ['Code', 'Code - Insiders'].map((n) => join(base, n, 'User', 'workspaceStorage')).filter(existsSync);
}

const norm = (p) => resolve(p).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

export function findWorkspaceStorage(folder, dirs = userDirs()) {
  const want = norm(folder);
  const hits = [];
  for (const dir of dirs) {
    for (const id of readdirSync(dir)) {
      try {
        const ws = JSON.parse(readFileSync(join(dir, id, 'workspace.json'), 'utf8'));
        if (ws.folder && norm(fileURLToPath(ws.folder)) === want) hits.push(join(dir, id));
      } catch { /* not a folder workspace */ }
    }
  }
  return hits;
}

// Session files are an initial snapshot plus set/push operations (.jsonl), or
// one JSON object (older builds). Walk everything and collect what we need.
export function summarizeSession(file) {
  const text = readFileSync(file, 'utf8');
  const docs = file.endsWith('.jsonl') ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [{ v: JSON.parse(text) }];
  const usage = new Map();
  const toolCalls = new Map();
  const models = new Map();
  let turns = 0;
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, path.concat(i))); return; }
    if (typeof o.promptTokens === 'number') {
      const turn = path[0] === 'requests' ? path[1] : path.includes('requests') ? path[path.indexOf('requests') + 1] : '?';
      usage.set(JSON.stringify([turn, o.promptTokens, o.completionTokens, o.copilotCredits]), { turn, ...o });
    }
    if (typeof o.modelId === 'string') models.set(o.modelId, (models.get(o.modelId) || 0) + 1);
    if ((o.kind === 'toolInvocationSerialized' || o.kind === 'toolInvocation') && (o.toolId || o.toolName)) {
      toolCalls.set(o.toolCallId || JSON.stringify(path), o.toolId || o.toolName);
    }
    for (const [k, v] of Object.entries(o)) walk(v, path.concat(k));
  };
  // Per request (last write wins): model calls = toolCallRounds, and the text of
  // every tool result the model received (file reads are not stored, so they count 0).
  const perRequest = new Map();
  const textOf = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join('')
    : typeof v === 'object' ? ['value', 'text', 'content'].map((k) => textOf(v[k])).join('') : '');
  for (const d of docs) {
    if (d.kind === 1 && Array.isArray(d.k) && d.k.at(-1) === 'result' && d.v?.metadata) {
      const m = d.v.metadata;
      const names = new Map();
      for (const r of m.toolCallRounds || []) for (const c of r.toolCalls || []) names.set(c.id, c.name);
      let terminal = 0, other = 0;
      for (const [cid, res] of Object.entries(m.toolCallResults || {})) {
        const t = estimateTokens(textOf(res?.content ?? res));
        if (/terminal/i.test(names.get(cid) || '')) terminal += t; else other += t;
      }
      perRequest.set(d.k[1], { modelCalls: (m.toolCallRounds || []).length, terminal, other });
    }
  }
  for (const d of docs) {
    if (d.kind === 0 && Array.isArray(d.v?.requests)) turns = Math.max(turns, d.v.requests.length);
    if (Array.isArray(d.k) && d.k.length === 1 && d.k[0] === 'requests') turns += Array.isArray(d.v) ? d.v.length : 1;
    walk(d.v, d.k || []);
  }
  if (!file.endsWith('.jsonl')) turns = docs[0].v?.requests?.length ?? turns;

  const records = [...usage.values()];
  const byGroup = {};
  const byTool = {};
  for (const id of toolCalls.values()) {
    byGroup[groupOf(id)] = (byGroup[groupOf(id)] || 0) + 1;
    byTool[id] = (byTool[id] || 0) + 1;
  }
  const withDetails = records.filter((r) => Array.isArray(r.promptTokenDetails) && r.promptTokenDetails.length);
  const breakdown = (r) => Object.fromEntries((r?.promptTokenDetails || []).map((x) => [x.label, x.percentageOfPrompt]));
  return {
    file: file.split(/[\\/]/).pop(),
    modified: new Date(statSync(file).mtimeMs).toISOString().slice(0, 16).replace('T', ' '),
    turns,
    toolCalls: toolCalls.size,
    byGroup,
    byTool,
    models: Object.fromEntries(models),
    maxContextTokens: Math.max(0, ...records.map((r) => r.promptTokens || 0)),
    outputTokens: records.reduce((a, r) => a + (r.completionTokens || 0), 0),
    credits: Math.round(records.reduce((a, r) => a + (typeof r.copilotCredits === 'number' ? r.copilotCredits : 0), 0) * 100) / 100,
    creditRecords: records.filter((r) => typeof r.copilotCredits === 'number').length,
    firstBreakdown: breakdown(withDetails[0]),
    lastBreakdown: breakdown(withDetails.at(-1)),
    modelCalls: [...perRequest.values()].reduce((a, r) => a + r.modelCalls, 0),
    terminalOutputTokens: [...perRequest.values()].reduce((a, r) => a + r.terminal, 0),
    otherToolOutputTokens: [...perRequest.values()].reduce((a, r) => a + r.other, 0)
  };
}

// Exact per-call numbers, written only when the user setting
// "github.copilot.chat.agentDebugLog.fileLogging.enabled" is true:
//   workspaceStorage/<id>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
// Events: llm_request {attrs: model, inputTokens, cachedTokens, outputTokens},
//         tool_call {name}, hook {name, attrs.output}, user_message, agent_response.
export function debugLogStats(storageDir, sessionId) {
  const file = join(storageDir, 'GitHub.copilot-chat', 'debug-logs', sessionId, 'main.jsonl');
  if (!existsSync(file)) return null;
  const s = { modelCalls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, byModel: {}, toolCalls: 0, byTool: {}, hooks: 0, tokenkit: { rewrites: 0, denies: 0, hints: 0 } };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const a = e.attrs || {};
    if (e.type === 'llm_request') {
      s.modelCalls++;
      s.inputTokens += Number(a.inputTokens) || 0;
      s.cachedTokens += Number(a.cachedTokens) || 0;
      s.outputTokens += Number(a.outputTokens) || 0;
      s.byModel[a.model || '?'] = (s.byModel[a.model || '?'] || 0) + 1;
    } else if (e.type === 'tool_call') {
      s.toolCalls++;
      s.byTool[e.name] = (s.byTool[e.name] || 0) + 1;
    } else if (e.type === 'hook') {
      s.hooks++;
      const out = String(a.output || '');
      if (out.includes('updatedInput') && out.includes('tk.mjs')) s.tokenkit.rewrites++;
      if (out.includes('[tokenkit]') && out.includes('"deny"')) s.tokenkit.denies++;
      if (out.includes('Likely locations') || out.includes('TaskSpec expanded')) s.tokenkit.hints++;
    }
  }
  return s.modelCalls || s.toolCalls || s.hooks ? s : null;
}

export function usageReport(folder, dirs) {
  const stores = findWorkspaceStorage(folder, dirs);
  if (!stores.length) return { folder, sessions: [], note: 'No VS Code workspace storage for this folder. Open it as a folder in VS Code (File > Open Folder) and chat once.' };
  const sessions = [];
  for (const s of stores) {
    const dir = join(s, 'chatSessions');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => /\.jsonl?$/.test(n))) {
      try {
        const summary = summarizeSession(join(dir, f));
        summary.debug = debugLogStats(s, f.replace(/\.jsonl?$/, ''));
        sessions.push(summary);
      } catch (e) { sessions.push({ file: f, error: String(e.message || e) }); }
    }
  }
  sessions.sort((a, b) => String(a.modified).localeCompare(String(b.modified)));
  return { folder, sessions };
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// Side by side: the most recent non-empty session in each folder.
export function formatCompare(a, b) {
  const latest = (r) => [...r.sessions].reverse().find((s) => !s.error && (s.turns || s.toolCalls));
  const A = latest(a), B = latest(b);
  const name = (r) => r.folder.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  if (!A || !B) return `Need a chat session in both folders (${name(a)}: ${A ? 'ok' : 'none'}, ${name(b)}: ${B ? 'ok' : 'none'}).`;
  const rows = [
    ['turns', A.turns, B.turns],
    ['model calls (each re-sends the context)', A.modelCalls, B.modelCalls],
    ['tool calls', A.toolCalls, B.toolCalls],
    ['  terminal', A.byGroup.terminal || 0, B.byGroup.terminal || 0],
    ['  browser', A.byGroup.browser || 0, B.byGroup.browser || 0],
    ['  read + search', (A.byGroup.read || 0) + (A.byGroup.search || 0), (B.byGroup.read || 0) + (B.byGroup.search || 0)],
    ['terminal output given to model (tokens)', A.terminalOutputTokens, B.terminalOutputTokens],
    ['largest context (tokens)', A.maxContextTokens, B.maxContextTokens],
    ['ToolDefs share at start (%)', A.firstBreakdown['Tool Definitions'] ?? '?', B.firstBreakdown['Tool Definitions'] ?? '?'],
    ['ToolResults share at end (%)', A.lastBreakdown['Tool Results'] ?? '?', B.lastBreakdown['Tool Results'] ?? '?'],
    ['credits recorded', A.credits, B.credits]
  ];
  if (A.debug && B.debug) {
    rows.push(['EXACT model calls', A.debug.modelCalls, B.debug.modelCalls],
      ['EXACT input tokens', A.debug.inputTokens, B.debug.inputTokens],
      ['EXACT uncached input', A.debug.inputTokens - A.debug.cachedTokens, B.debug.inputTokens - B.debug.cachedTokens],
      ['EXACT output tokens', A.debug.outputTokens, B.debug.outputTokens],
      ['tokenkit hook actions', A.debug.tokenkit.rewrites + A.debug.tokenkit.denies + A.debug.tokenkit.hints, B.debug.tokenkit.rewrites + B.debug.tokenkit.denies + B.debug.tokenkit.hints]);
  }
  const diff = (x, y) => (typeof x === 'number' && typeof y === 'number' && x ? `${y >= x ? '+' : ''}${Math.round(((y - x) / x) * 100)}%` : '');
  const w = Math.max(...rows.map((r) => r[0].length));
  const out = [`${''.padEnd(w)}  ${name(a).padStart(14)}  ${name(b).padStart(14)}  change`,
    ...rows.map(([k, x, y]) => `${k.padEnd(w)}  ${String(typeof x === 'number' ? fmt(x) : x).padStart(14)}  ${String(typeof y === 'number' ? fmt(y) : y).padStart(14)}  ${diff(x, y)}`)];
  out.push('', `sessions: ${A.file.slice(0, 8)} (${A.modified}) vs ${B.file.slice(0, 8)} (${B.modified})`);
  if (!(A.debug && B.debug)) out.push('No EXACT rows: turn on "github.copilot.chat.agentDebugLog.fileLogging.enabled" and re-run both.');
  return out.join('\n');
}

const pct = (b) => ['System Instructions', 'Tool Definitions', 'Messages', 'Tool Results']
  .map((k) => `${k.replace('System Instructions', 'System').replace('Tool Definitions', 'ToolDefs').replace('Tool Results', 'ToolResults')} ${b[k] ?? '?'}%`).join(' · ');

export function formatUsage(r) {
  const out = [`VS Code chat usage for ${r.folder}`];
  if (!r.sessions.length) return [...out, r.note || 'No chat sessions found.'].join('\n');
  const empty = r.sessions.filter((s) => !s.error && !s.turns && !s.toolCalls).length;
  for (const s of r.sessions.filter((x) => x.error || x.turns || x.toolCalls)) {
    if (s.error) { out.push('', `session ${s.file}: could not read (${s.error})`); continue; }
    const groups = Object.entries(s.byGroup).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(', ');
    out.push('',
      `session ${s.file.slice(0, 8)} · last change ${s.modified} · ${s.turns} turn(s) · models: ${Object.keys(s.models).join(', ') || '?'}`,
      `  model calls     ${s.modelCalls} · terminal output given to the model ~${fmt(s.terminalOutputTokens)} tokens`,
      `  tool calls      ${s.toolCalls}${groups ? ` (${groups})` : ''}`,
      `  largest context ~${s.maxContextTokens.toLocaleString('en-US')} tokens · output ~${s.outputTokens.toLocaleString('en-US')} tokens recorded`,
      `  credits         ${s.credits} recorded on ${s.creditRecords} of the session's usage records (VS Code does not record every step)`,
      `  prompt share    first: ${pct(s.firstBreakdown)}`,
      `                  last:  ${pct(s.lastBreakdown)}`);
    if (s.debug) {
      const d = s.debug;
      out.push(`  EXACT (Agent Debug Log): ${d.modelCalls} model calls · input ${fmt(d.inputTokens)} tokens (${fmt(d.cachedTokens)} cached, ${fmt(d.inputTokens - d.cachedTokens)} uncached) · output ${fmt(d.outputTokens)}`,
        `                           hooks ${d.hooks} · tokenkit: ${d.tokenkit.rewrites} rewrites, ${d.tokenkit.denies} denies, ${d.tokenkit.hints} hints`);
    }
  }
  if (!r.sessions.some((s) => s.debug)) {
    out.push('', 'For exact per-call token counts, turn on the user setting', '  "github.copilot.chat.agentDebugLog.fileLogging.enabled": true', 'and run the prompt again (it only records sessions started after it is on).');
  }
  if (empty) out.push('', `(${empty} empty session(s) not shown)`);
  out.push('', 'Compare runs of the SAME prompt with the SAME model. Tool calls and largest context are the most reliable numbers here.');
  return out.join('\n');
}
