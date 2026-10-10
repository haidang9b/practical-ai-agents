import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatUsage, usageReport } from '../src/lib/usage.mjs';

// Mirrors the shape VS Code 1.141 writes to workspaceStorage/<id>/chatSessions/*.jsonl:
// a snapshot (kind 0) followed by set operations on key paths (kind 1).
test('tk usage summarizes a VS Code chat session log for a folder', () => {
  const storage = mkdtempSync(join(tmpdir(), 'tk-ws-'));
  const folder = mkdtempSync(join(tmpdir(), 'tk-app-'));
  const ws = join(storage, 'abc123');
  mkdirSync(join(ws, 'chatSessions'), { recursive: true });
  writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folder).href }));
  const tool = (id, n) => ({ kind: 'toolInvocationSerialized', toolId: id, toolCallId: `${id}-${n}` });
  const lines = [
    { kind: 0, v: { version: 3, requests: [{ modelId: 'copilot/auto', response: [] }] } },
    { kind: 1, k: ['requests', 0, 'response'], v: [tool('run_in_terminal', 1), tool('copilot_readFile', 2), tool('navigate_page', 3), tool('click_element', 4)] },
    { kind: 1, k: ['requests', 0, 'usage'], v: { promptTokens: 27000, completionTokens: 800, copilotCredits: 0.5,
      promptTokenDetails: [
        { category: 'System', label: 'System Instructions', percentageOfPrompt: 38 },
        { category: 'System', label: 'Tool Definitions', percentageOfPrompt: 50 },
        { category: 'User Context', label: 'Messages', percentageOfPrompt: 4 },
        { category: 'User Context', label: 'Tool Results', percentageOfPrompt: 8 }] } },
    { kind: 1, k: ['requests', 0, 'usage'], v: { promptTokens: 58000 } }
  ];
  writeFileSync(join(ws, 'chatSessions', 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  writeFileSync(join(ws, 'chatSessions', 'empty.jsonl'), JSON.stringify({ kind: 0, v: { requests: [] } }));

  const r = usageReport(folder, [storage]);
  const s = r.sessions.find((x) => x.file === 's1.jsonl');
  assert.equal(s.turns, 1);
  assert.equal(s.toolCalls, 4);
  assert.deepEqual(s.byGroup, { terminal: 1, read: 1, browser: 2 });
  assert.equal(s.maxContextTokens, 58000);
  assert.equal(s.credits, 0.5);
  assert.equal(s.firstBreakdown['Tool Definitions'], 50);
  const text = formatUsage(r);
  assert.match(text, /tool calls {6}4 \(browser 2, terminal 1, read 1\)/);
  assert.match(text, /System 38% · ToolDefs 50% · Messages 4% · ToolResults 8%/);
  assert.match(text, /\(1 empty session\(s\) not shown\)/);

  assert.deepEqual(usageReport(mkdtempSync(join(tmpdir(), 'tk-none-')), [storage]).sessions, []);
});

test('tk usage reads exact numbers from the Agent Debug Log and compares two folders', async () => {
  const { debugLogStats, formatCompare } = await import('../src/lib/usage.mjs');
  const storage = mkdtempSync(join(tmpdir(), 'tk-ws2-'));
  const mk = (id, folderName, events, credits) => {
    const folder = mkdtempSync(join(tmpdir(), `${folderName}-`));
    const ws = join(storage, id);
    mkdirSync(join(ws, 'chatSessions'), { recursive: true });
    mkdirSync(join(ws, 'GitHub.copilot-chat', 'debug-logs', 'sess'), { recursive: true });
    writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(folder).href }));
    writeFileSync(join(ws, 'chatSessions', 'sess.jsonl'), [
      { kind: 0, v: { requests: [{ modelId: 'm' }] } },
      { kind: 1, k: ['requests', 0, 'response'], v: [{ kind: 'toolInvocationSerialized', toolId: 'run_in_terminal', toolCallId: 't1' }] },
      { kind: 1, k: ['requests', 0, 'usage'], v: { promptTokens: 30000, copilotCredits: credits } }
    ].map((l) => JSON.stringify(l)).join('\n'));
    writeFileSync(join(ws, 'GitHub.copilot-chat', 'debug-logs', 'sess', 'main.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
    return folder;
  };
  const llm = (input, cached, output) => ({ type: 'llm_request', name: 'chat:m', attrs: { model: 'm', inputTokens: input, cachedTokens: cached, outputTokens: output } });
  const without = mk('w1', 'without', [{ type: 'session_start' }, llm(30000, 0, 500), llm(42000, 30000, 400), { type: 'tool_call', name: 'run_in_terminal' }], 1.2);
  const withKit = mk('w2', 'with', [
    { type: 'session_start' }, llm(31000, 0, 300), llm(33000, 31000, 200),
    { type: 'hook', name: 'UserPromptSubmit', attrs: { output: '{"additionalContext":"[tokenkit] Likely locations ..."}' } },
    { type: 'hook', name: 'PreToolUse', attrs: { output: '{"hookSpecificOutput":{"updatedInput":{"command":"node \\".tokenkit/tk.mjs\\" run -- npm test"}}}' } }
  ], 0.8);

  const d = debugLogStats(join(storage, 'w2'), 'sess');
  assert.deepEqual({ calls: d.modelCalls, input: d.inputTokens, cached: d.cachedTokens, output: d.outputTokens }, { calls: 2, input: 64000, cached: 31000, output: 500 });
  assert.deepEqual(d.tokenkit, { rewrites: 1, denies: 0, hints: 1 });
  assert.equal(debugLogStats(join(storage, 'w2'), 'missing'), null);

  const text = formatCompare(usageReport(without, [storage]), usageReport(withKit, [storage]));
  assert.match(text, /EXACT input tokens\s+72,000\s+64,000\s+-11%/);
  assert.match(text, /EXACT uncached input\s+42,000\s+33,000\s+-21%/);
  assert.match(text, /tokenkit hook actions\s+0\s+2/);
});
