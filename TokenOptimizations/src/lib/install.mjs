import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { KIT_DIR } from './config.mjs';
import { writeMap } from './repomap.mjs';

const START = '<!-- tokenkit:start -->';
const END = '<!-- tokenkit:end -->';
const MERGE = new Set(['.github/copilot-instructions.md']);
const GITIGNORE = ['.tokenkit/logs/', '.tokenkit/repomap.md', '.tokenkit/handoff.md'];

const sha = (s) => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function mergeBlock(existing, template) {
  const block = template.slice(template.indexOf(START), template.indexOf(END) + END.length);
  const s = existing.indexOf(START), e = existing.indexOf(END);
  if (s >= 0 && e > s) return existing.slice(0, s) + block + existing.slice(e + END.length);
  return `${existing.trimEnd()}\n\n${block}\n`;
}

export function install(targetArg, { dryRun = false, force = false } = {}) {
  const templates = join(KIT_DIR, '..', 'templates');
  if (!existsSync(templates)) throw new Error('templates/ not found: run install from the tokenkit source checkout.');
  const target = resolve(targetArg);
  if (!existsSync(target)) throw new Error(`target does not exist: ${target}`);
  const log = [];
  const write = (rel, content) => {
    if (!dryRun) { mkdirSync(dirname(join(target, rel)), { recursive: true }); writeFileSync(join(target, rel), content); }
  };

  // 1. Runtime -> <target>/.tokenkit (keeps the target's config.json, logs, map).
  const kitDest = join(target, '.tokenkit');
  if (!dryRun) {
    cpSync(KIT_DIR, kitDest, {
      recursive: true,
      filter: (src) => {
        const rel = relative(KIT_DIR, src).replace(/\\/g, '/');
        if (rel === 'logs' || rel.startsWith('logs/') || rel === 'repomap.md') return false;
        if (rel === 'config.json' && existsSync(join(kitDest, 'config.json'))) return false;
        return true;
      }
    });
  }
  log.push('runtime   .tokenkit/ (tk.mjs, lib/, hooks/)');

  // 2. Templates: never clobber the user's files; merge the instructions block.
  // The manifest records what tokenkit wrote, so a later install can upgrade
  // files nobody has edited since, and leave edited or user-owned files alone.
  const manifestPath = join(kitDest, 'manifest.json');
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* first install */ }
  const next = {};
  for (const abs of walk(templates)) {
    const rel = relative(templates, abs).replace(/\\/g, '/');
    const tpl = readFileSync(abs, 'utf8');
    const dest = join(target, rel);
    const cur = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (MERGE.has(rel) && cur !== null) {
      const merged = mergeBlock(cur, tpl);
      if (merged !== cur) { write(rel, merged); log.push(`merged    ${rel} (tokenkit block)`); }
      else log.push(`unchanged ${rel}`);
    } else if (cur === null || force) {
      write(rel, tpl); next[rel] = sha(tpl);
      log.push(`${cur === null ? 'created ' : 'replaced'}  ${rel}`);
    } else if (sha(cur) === sha(tpl)) {
      next[rel] = sha(tpl);
      log.push(`unchanged ${rel}`);
    } else if (manifest[rel] === sha(cur)) {
      write(rel, tpl); next[rel] = sha(tpl);
      log.push(`updated   ${rel}`);
    } else {
      log.push(`skipped   ${rel} (${manifest[rel] ? 'edited locally' : 'not created by tokenkit'}; --force to overwrite)`);
      if (manifest[rel]) next[rel] = manifest[rel];
    }
  }
  // Files an older tokenkit installed but this version no longer ships: remove
  // them if untouched (they would keep costing tokens), keep them if edited.
  for (const [rel, hash] of Object.entries(manifest)) {
    if (rel in next || existsSync(join(templates, rel))) continue;
    const p = join(target, rel);
    if (!existsSync(p)) continue;
    if (sha(readFileSync(p, 'utf8')) !== hash) { log.push(`kept      ${rel} (no longer part of tokenkit, but edited locally)`); continue; }
    if (!dryRun) {
      rmSync(p);
      for (let d = dirname(p); d.startsWith(target) && d !== target; d = dirname(d)) {
        try { if (readdirSync(d).length === 0) rmdirSync(d); else break; } catch { break; }
      }
    }
    log.push(`retired   ${rel} (no longer part of tokenkit)`);
  }
  if (!dryRun) writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n');

  // 3. .gitignore
  const gi = join(target, '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const missing = GITIGNORE.filter((l) => !cur.split(/\r?\n/).includes(l));
  if (missing.length) {
    write('.gitignore', `${cur.trimEnd()}${cur ? '\n\n' : ''}# tokenkit (generated)\n${missing.join('\n')}\n`);
    log.push(`updated   .gitignore (+${missing.join(', ')})`);
  }

  // 4. First repo map
  if (!dryRun) {
    const r = writeMap(target, join(kitDest, 'repomap.md'));
    log.push(`map       .tokenkit/repomap.md (${r.files} files, ~${r.tokens} tokens, level ${r.level})`);
  }
  return log;
}

// Reverse of install. Removes only what tokenkit wrote and nobody has edited
// since (per the manifest); edited files are reported, never deleted.
export function uninstall(targetArg, { dryRun = false } = {}) {
  const target = resolve(targetArg);
  const kitDest = join(target, '.tokenkit');
  const log = [];
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(join(kitDest, 'manifest.json'), 'utf8')); } catch {
    log.push('note      no .tokenkit/manifest.json; only the instructions block, .gitignore lines and .tokenkit/ are removed');
  }

  for (const [rel, hash] of Object.entries(manifest)) {
    const p = join(target, rel);
    if (!existsSync(p)) continue;
    if (sha(readFileSync(p, 'utf8')) !== hash) { log.push(`kept      ${rel} (edited locally; remove by hand if unwanted)`); continue; }
    if (!dryRun) rmSync(p);
    log.push(`removed   ${rel}`);
    // Drop folders the removal left empty, up to (not including) the repo root.
    for (let d = dirname(p); d.startsWith(target) && d !== target; d = dirname(d)) {
      try { if (!dryRun && readdirSync(d).length === 0) rmdirSync(d); else break; } catch { break; }
    }
  }

  const ins = join(target, '.github/copilot-instructions.md');
  if (existsSync(ins)) {
    const cur = readFileSync(ins, 'utf8');
    const s = cur.indexOf(START), e = cur.indexOf(END);
    if (s >= 0 && e > s) {
      const rest = (cur.slice(0, s).trimEnd() + '\n' + cur.slice(e + END.length).trimStart()).trim();
      if (!dryRun) { if (rest) writeFileSync(ins, `${rest}\n`); else rmSync(ins); }
      log.push(rest ? 'unmerged  .github/copilot-instructions.md (tokenkit block removed, your content kept)' : 'removed   .github/copilot-instructions.md (it held only the tokenkit block)');
    }
  }

  const gi = join(target, '.gitignore');
  if (existsSync(gi)) {
    const lines = readFileSync(gi, 'utf8').split(/\r?\n/);
    const kept = lines.filter((l) => l !== '# tokenkit (generated)' && !GITIGNORE.includes(l));
    if (kept.length !== lines.length) {
      if (!dryRun) writeFileSync(gi, `${kept.join('\n').trimEnd()}\n`);
      log.push('updated   .gitignore (tokenkit lines removed)');
    }
  }

  if (existsSync(kitDest)) {
    if (!dryRun) rmSync(kitDest, { recursive: true, force: true });
    log.push('removed   .tokenkit/ (runtime, config, logs, repo map)');
  }
  return log;
}
