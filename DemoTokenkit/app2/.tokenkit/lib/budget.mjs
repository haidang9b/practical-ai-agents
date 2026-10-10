import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig } from './config.mjs';
import { estimateTokens } from './tokens.mjs';

// Audits what Copilot sends on every request (instructions, skill
// descriptions) versus on demand, and flags common sources of bloat.

const FILLER = /\b(please|make sure( to)?|it is (very )?important( that| to)?|always remember( to)?|keep in mind( that)?|be sure to|note that|you should|in order to|as an ai|feel free to|don't forget( to)?|try to)\b/gi;
const ALWAYS_GLOBS = new Set(['**', '**/*', '*', '**/*.*']);

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) block.push(lines[++i].trim());
      val = block.join(val.startsWith('>') ? ' ' : '\n').trim();
    }
    data[kv[1]] = val.replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: text.slice(m[0].length) };
}

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const listDir = (p) => { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } };

function walkMd(dir, suffix, out = []) {
  for (const e of listDir(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, suffix, out);
    else if (e.name.endsWith(suffix)) out.push(p);
  }
  return out;
}

function lint(rel, text, findings) {
  const lines = text.split(/\r?\n/);
  let fence = -1;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (fence < 0) fence = i;
      else {
        if (i - fence - 1 > 8) findings.push(`${rel}:${fence + 1} ${i - fence - 1}-line code block in always-on context; move it into a skill or path-scoped instructions`);
        fence = -1;
      }
      return;
    }
    if (fence >= 0) return;
    const fill = line.match(FILLER);
    if (fill) findings.push(`${rel}:${i + 1} filler "${fill[0]}" (delete it; instructions are read literally)`);
    if (line.length > 400) findings.push(`${rel}:${i + 1} ${line.length}-char paragraph; rewrite as terse bullets`);
  });
}

export function audit(root) {
  const cfg = loadConfig().budget;
  const always = [];   // { label, tokens }
  const onDemand = []; // { label, tokens, note }
  const findings = [];
  const seen = new Map(); // normalized line -> first file
  const dupes = [];

  const addAlways = (abs, label = relative(root, abs).replace(/\\/g, '/'), text = read(abs)) => {
    if (text == null) return;
    always.push({ label, tokens: estimateTokens(text) });
    lint(label, text, findings);
    for (const line of text.split(/\r?\n/)) {
      const n = line.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (n.length < 24) continue;
      if (seen.has(n) && seen.get(n) !== label) dupes.push(`${label} repeats a line from ${seen.get(n)}: "${line.trim().slice(0, 60)}"`);
      else seen.set(n, label);
    }
  };

  for (const f of ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    if (existsSync(join(root, f))) addAlways(join(root, f));
  }
  const roots = ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md'].filter((f) => existsSync(join(root, f)));
  if (roots.length > 1) findings.push(`${roots.join(' + ')} are all loaded together; keep one source of truth and make the others one-line pointers`);

  for (const abs of walkMd(join(root, '.github/instructions'), '.instructions.md')) {
    const rel = relative(root, abs).replace(/\\/g, '/');
    const text = read(abs);
    const { data } = parseFrontmatter(text);
    const globs = String(data.applyTo || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (globs.some((g) => ALWAYS_GLOBS.has(g))) {
      addAlways(abs);
      findings.push(`${rel} has applyTo "${data.applyTo}" so it is effectively always-on; narrow the glob`);
    } else {
      onDemand.push({ label: rel, tokens: estimateTokens(text), note: globs.length ? `applyTo ${globs.join(',')}` : 'manual / by description' });
    }
  }

  for (const dir of ['.github/skills', '.claude/skills', '.agents/skills']) {
    for (const e of listDir(join(root, dir))) {
      if (!e.isDirectory()) continue;
      const abs = join(root, dir, e.name, 'SKILL.md');
      const text = read(abs);
      if (text == null) continue;
      const { data, body } = parseFrontmatter(text);
      const desc = data.description || '';
      always.push({ label: `skill ${e.name} (name+description)`, tokens: estimateTokens(`${data.name} ${desc}`) + 8 });
      onDemand.push({ label: `${dir}/${e.name}/SKILL.md body`, tokens: estimateTokens(body), note: 'loaded when relevant' });
      if (data.name && data.name !== e.name) findings.push(`${dir}/${e.name}: name "${data.name}" must equal the folder name or the skill is silently skipped`);
      if (!desc) findings.push(`${dir}/${e.name}: missing description, so it can never be auto-selected`);
      if (desc.length > cfg.skillDescriptionChars) findings.push(`${dir}/${e.name}: description is ${desc.length} chars and is sent on every request; trim to under ${cfg.skillDescriptionChars}`);
    }
  }

  for (const [dir, suffix] of [['.github/agents', '.agent.md'], ['.github/prompts', '.prompt.md'], ['.github/chatmodes', '.chatmode.md']]) {
    for (const abs of walkMd(join(root, dir), suffix)) {
      const rel = relative(root, abs).replace(/\\/g, '/');
      const text = read(abs);
      const { data } = parseFrontmatter(text);
      const notes = [];
      if (!data.tools) notes.push('no tools list, so every tool schema is sent');
      if (data.model) notes.push(`model ${data.model}`);
      onDemand.push({ label: rel, tokens: estimateTokens(text), note: notes.join('; ') || 'on demand' });
      if (suffix === '.chatmode.md') findings.push(`${rel}: .chatmode.md is legacy; rename to .github/agents/*.agent.md`);
    }
  }

  for (const f of ['.vscode/mcp.json', '.mcp.json', '.github/copilot/mcp.json']) {
    const text = read(join(root, f));
    if (!text) continue;
    try {
      const j = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
      const servers = Object.keys(j.servers || j.mcpServers || {});
      if (servers.length) findings.push(`${f}: ${servers.length} MCP server(s) (${servers.join(', ')}). Every enabled tool schema is input on every call, and toggling tools mid-session breaks the prompt cache. Restrict tools per agent instead`);
    } catch { findings.push(`${f}: could not parse`); }
  }

  const total = always.reduce((a, b) => a + b.tokens, 0);
  return { always, onDemand, total, budget: cfg.alwaysOnTokens, findings: [...findings, ...dupes.slice(0, 10)] };
}

export function formatAudit(r) {
  const pad = (n) => `~${String(n).padStart(5)}`;
  const out = ['ALWAYS-ON (sent with every request)'];
  if (!r.always.length) out.push('   (none)');
  for (const a of r.always) out.push(`  ${pad(a.tokens)}  ${a.label}`);
  out.push(`  ${pad(r.total)}  TOTAL  ${r.total <= r.budget ? 'OK' : 'OVER'} (budget ${r.budget})`, '', 'ON DEMAND');
  if (!r.onDemand.length) out.push('   (none)');
  for (const a of r.onDemand) out.push(`  ${pad(a.tokens)}  ${a.label}${a.note ? `  [${a.note}]` : ''}`);
  out.push('', `FINDINGS (${r.findings.length})`);
  for (const f of r.findings) out.push(`  - ${f}`);
  return out.join('\n');
}
