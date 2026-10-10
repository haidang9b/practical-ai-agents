#!/usr/bin/env node
// userPromptSubmitted hook (VS Code: UserPromptSubmit). Gives plain-language
// requests what a TaskSpec line gives explicitly: where to start reading.
//  - TaskSpec line   -> its expansion, with #Symbol resolved to exact lines
//  - plain language  -> up to 5 "likely locations" from the repo map, or nothing
// VS Code appends `additionalContext` before the agent's first step (verified
// in VS Code 1.141 / Copilot Chat 0.69). Copilot CLI ignores this output.
import { join } from 'node:path';
import { KIT_DIR, loadConfig } from '../lib/config.mjs';
import { logEvent, runHook } from '../lib/hookio.mjs';
import { formatHints, locate } from '../lib/locate.mjs';
import { mapIsStale, writeMap } from '../lib/repomap.mjs';
import { expandSpec, parseSpec } from '../lib/spec.mjs';
import { estimateTokens } from '../lib/tokens.mjs';

function emitContext(text) {
  process.stdout.write(JSON.stringify({
    additionalContext: text,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text }
  }));
}

runHook(async (payload) => {
  const cfg = loadConfig().prompt;
  const prompt = String(payload.prompt ?? payload.user_prompt ?? '');
  if (cfg.hints === 'off' || prompt.trim().length < 8) return;
  const root = join(KIT_DIR, '..');

  const spec = parseSpec(prompt);
  if (spec.verb && (spec.scopes.length || spec.flags.length)) {
    const text = `[tokenkit] TaskSpec expanded:\n${expandSpec(prompt, root).text}`;
    logEvent('prompt.jsonl', { kind: 'taskspec', tokens: estimateTokens(text) });
    return emitContext(text);
  }

  // Files often appear mid-session (the agent just created them): refresh first.
  const mapFile = join(KIT_DIR, 'repomap.md');
  const stale = mapIsStale(root, mapFile);
  if (stale) writeMap(root, mapFile);

  const r = locate(prompt, root, { maxHints: cfg.maxHints, minScore: cfg.minScore });
  if (!r.hints.length) return logEvent('prompt.jsonl', { kind: 'none', reason: r.reason });
  const text = formatHints(r.hints);
  logEvent('prompt.jsonl', { kind: 'hints', hints: r.hints.length, tokens: estimateTokens(text) });
  emitContext(text);
});
