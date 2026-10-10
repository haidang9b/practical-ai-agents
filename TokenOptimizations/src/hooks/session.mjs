#!/usr/bin/env node
// sessionStart hook: refresh the repo map when it is missing or stale.
// Injects nothing into the context; a stable prompt prefix keeps the cache warm.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_DIR, loadConfig } from '../lib/config.mjs';
import { logEvent, runHook } from '../lib/hookio.mjs';
import { writeMap } from '../lib/repomap.mjs';

runHook(async (payload) => {
  const out = join(KIT_DIR, 'repomap.md');
  const maxAge = loadConfig().map.maxAgeMinutes * 60_000;
  let age = Infinity;
  try { age = Date.now() - statSync(out).mtimeMs; } catch { /* missing */ }
  if (age < maxAge) return;
  const root = join(KIT_DIR, '..');
  const r = writeMap(root, out);
  logEvent('session.jsonl', { event: 'map', files: r.files, tokens: r.tokens, level: r.level, cwd: payload.cwd });
});
