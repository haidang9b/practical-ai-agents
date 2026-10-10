import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    lastBreakdown: breakdown(withDetails.at(-1))
  };
}

export function usageReport(folder, dirs) {
  const stores = findWorkspaceStorage(folder, dirs);
  if (!stores.length) return { folder, sessions: [], note: 'No VS Code workspace storage for this folder. Open it as a folder in VS Code (File > Open Folder) and chat once.' };
  const sessions = [];
  for (const s of stores) {
    const dir = join(s, 'chatSessions');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => /\.jsonl?$/.test(n))) {
      try { sessions.push(summarizeSession(join(dir, f))); } catch (e) { sessions.push({ file: f, error: String(e.message || e) }); }
    }
  }
  sessions.sort((a, b) => String(a.modified).localeCompare(String(b.modified)));
  return { folder, sessions };
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
      `  tool calls      ${s.toolCalls}${groups ? ` (${groups})` : ''}`,
      `  largest context ~${s.maxContextTokens.toLocaleString('en-US')} tokens · output ~${s.outputTokens.toLocaleString('en-US')} tokens recorded`,
      `  credits         ${s.credits} recorded on ${s.creditRecords} of the session's usage records (VS Code does not record every step)`,
      `  prompt share    first: ${pct(s.firstBreakdown)}`,
      `                  last:  ${pct(s.lastBreakdown)}`);
  }
  if (empty) out.push('', `(${empty} empty session(s) not shown)`);
  out.push('', 'Compare runs of the SAME prompt with the SAME model. Tool calls and largest context are the most reliable numbers here.');
  return out.join('\n');
}
