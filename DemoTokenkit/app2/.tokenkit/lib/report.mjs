import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from './config.mjs';
import { fmtTokens } from './tokens.mjs';

function load(file, since) {
  let text = '';
  try { text = readFileSync(join(LOG_DIR, file), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && (!since || Date.parse(r.ts) >= since));
}

export function report({ days = 7 } = {}) {
  const since = Date.now() - days * 86_400_000;
  const runs = load('runs.jsonl', since);
  const tools = load('tools.jsonl', since);
  const guard = load('guard.jsonl', since);
  const out = [`tokenkit report · last ${days} day(s) · logs: ${LOG_DIR}`, ''];

  const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0);
  const pct = (a, b) => (b ? `${Math.round((1 - a / b) * 100)}%` : '0%');

  const rawRun = sum(runs, 'rawTokens'), keptRun = sum(runs, 'keptTokens');
  out.push(`tk run        ${runs.length} run(s): ~${fmtTokens(rawRun)} → ~${fmtTokens(keptRun)} tokens (${pct(keptRun, rawRun)} kept out of context)`);
  const post = tools.filter((t) => t.keptTokens !== undefined);
  const rawPost = sum(post, 'tokens'), keptPost = sum(post, 'keptTokens');
  out.push(`post-compress ${post.length} output(s): ~${fmtTokens(rawPost)} → ~${fmtTokens(keptPost)} tokens (${pct(keptPost, rawPost)})`);
  const prompts = load('prompt.jsonl', since);
  const hinted = prompts.filter((p) => p.kind === 'hints'), specs = prompts.filter((p) => p.kind === 'taskspec');
  out.push(`prompts       ${prompts.length} prompt(s): ${hinted.length} got location hints, ${specs.length} TaskSpec expansion(s), ~${fmtTokens(sum([...hinted, ...specs], 'tokens'))} tokens added`);
  const by = (xs, f) => xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) || 0) + 1), new Map());
  const g = by(guard, (x) => `${x.action}:${x.rule}`);
  out.push(`guard         ${guard.length} intervention(s)${g.size ? ': ' + [...g].map(([k, n]) => `${k}×${n}`).join(', ') : ''}`);

  if (tools.length) {
    const agg = new Map();
    for (const t of tools) {
      const a = agg.get(t.tool) || { calls: 0, tokens: 0, max: 0 };
      a.calls++; a.tokens += t.keptTokens ?? t.tokens; a.max = Math.max(a.max, t.tokens);
      agg.set(t.tool, a);
    }
    out.push('', 'Tool output reaching the model (by tool):', '   tokens  calls    max  tool');
    for (const [name, a] of [...agg].sort((x, y) => y[1].tokens - x[1].tokens).slice(0, 12)) {
      out.push(`  ${fmtTokens(a.tokens).padStart(7)}  ${String(a.calls).padStart(5)}  ${fmtTokens(a.max).padStart(5)}  ${name}`);
    }
    out.push('', 'Largest single outputs:');
    for (const t of [...tools].sort((x, y) => y.tokens - x.tokens).slice(0, 8)) {
      out.push(`  ${fmtTokens(t.tokens).padStart(7)}  ${t.tool}  ${t.target}`);
    }
  } else {
    out.push('', 'No tool-output log yet. It fills once the hooks are active (.github/hooks/tokenkit.json).');
  }
  return out.join('\n');
}
