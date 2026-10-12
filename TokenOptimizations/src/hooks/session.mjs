#!/usr/bin/env node
// sessionStart hook: refresh the repo map when it is missing or stale (old,
// or source files added/changed since it was written).
// Injects nothing into the context; a stable prompt prefix keeps the cache warm.
import { join } from 'node:path';
import { KIT_DIR } from '../lib/config.mjs';
import { logEvent, runHook } from '../lib/hookio.mjs';
import { mapIsStale, writeMap } from '../lib/repomap.mjs';

runHook(async (payload) => {
  const out = join(KIT_DIR, 'repomap.md');
  const root = join(KIT_DIR, '..');
  const why = mapIsStale(root, out);
  if (!why) return;
  const r = writeMap(root, out);
  logEvent('session.jsonl', { event: 'map', why, files: r.files, read: r.read, tokens: r.tokens, cwd: payload.cwd });
});
