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
