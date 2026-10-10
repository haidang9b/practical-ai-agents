// Command classification used by the preToolUse guard.

const PIPED_OR_REDIRECTED = /\|\s*\S|(^|[^>&2])>\s*\S|\s&\s*$/;
const LONG_RUNNING = /--watch\b|\bwatch\b|\s-w(\s|$)|--ui\b|\b(dev|serve|start|preview)\b|\bnodemon\b|--interactive\b/;

// Finite commands whose output is long and mostly irrelevant on success.
export const VERBOSE = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck|type-check|check|e2e|ci)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|ci|add|update)\b/,
  /\b(npx\s+|pnpm\s+exec\s+)?(jest|vitest|mocha|ava|tsc|eslint|playwright\s+test|cypress\s+run|nx\s+(run|test|build|affected))\b/,
  /\b(pytest|tox|nox|mypy|ruff\s+check|pylint|flake8)\b|\bpython\d?(\.\d+)?\s+-m\s+(pytest|unittest|mypy|pip\s+install)\b/,
  /\b(pip\d?|uv\s+pip|poetry|uv)\s+(install|sync|lock)\b/,
  /\bgo\s+(test|build|vet|mod\s+(download|tidy))\b|\bgolangci-lint\b/,
  /\bcargo\s+(test|build|check|clippy|nextest)\b/,
  /\bdotnet\s+(test|build|restore|publish|pack)\b|\bmsbuild\b/,
  /\b(mvn|mvnw|\.\/mvnw)\b|\b(gradle|gradlew|\.\/gradlew)\b/,
  /\b(make|ninja|cmake\s+--build|ctest|bazel\s+(build|test)|meson\s+test)\b/,
  /\b(bundle\s+(install|exec\s+rspec)|rspec|rake\s+test|composer\s+install|phpunit|mix\s+test|swift\s+(build|test)|flutter\s+test|dart\s+test)\b/,
  /\bdocker\s+(build|compose\s+build|buildx\s+build)\b/,
  /\bterraform\s+(plan|init)\b/
];

// Commands that must carry an explicit bound; otherwise denied with a hint.
export const BOUNDED = [
  { re: /\bgit\s+log\b/, ok: /\s-n\s*\d+|\s-\d+\b|--max-count|\.\.|\s-L\s*\d|--since|--after/, hint: 'git log is unbounded here; add -n 20 (plus --oneline or --stat as needed).' },
  { re: /\bgit\s+(diff|show)\b/, ok: /--stat|--name-only|--name-status|--shortstat|\s--\s+\S|\s-U\d|\S+\.\w+\s*$/, hint: 'Unscoped git diff/show can be huge; start with --stat, then diff specific paths (git diff -- path).', soft: true },
  { re: /\bls\s+-\w*R/, ok: /$^/, hint: 'Recursive listing dumps every path; grep .tokenkit/repomap.md or use git ls-files <dir>.' },
  { re: /\btree\b/, ok: /-L\s*\d/, hint: 'Use tree -L 2 (bounded depth), or grep .tokenkit/repomap.md.' },
  { re: /\b(Get-ChildItem|gci)\b[^|]*-Recurse\b/i, ok: /-(Filter|Include|Depth)\b/i, hint: 'Add -Depth 2 or -Filter, or grep .tokenkit/repomap.md.' },
  { re: /\bdir\b[^|]*\s\/s\b/i, ok: /$^/, hint: 'Recursive dir dumps every path; grep .tokenkit/repomap.md or use git ls-files <dir>.' },
  { re: /\bfind\s+\.{1,2}(\/\S*)?(\s|$)/, ok: /-(maxdepth|name|iname|path|ipath|regex|newer|mtime|mmin)\b/, hint: 'Add -maxdepth or -name, or use git ls-files <dir> (respects .gitignore).' },
  { re: /\b(docker|kubectl|podman)\s+logs\b/, ok: /--tail[\s=]\d|--since/, hint: 'Add --tail 100 (or --since 10m).' },
  { re: /\bjournalctl\b/, ok: /\s-n\s*\d+|--lines|--since/, hint: 'Add -n 100 or --since.' }
];

const READERS = /^\s*(cat|type|Get-Content|gc|more|less|bat|head|tail)\s+/i;

// Readable when possible (the user may have to approve it); base64 only when
// shell quoting would be fragile, with the original shown as a trailing comment.
const SIMPLE = /^[\w@%+=:,./ -]+$/;
export function wrapCommand(cmd, shell, kit) {
  const base = `node "${kit}/tk.mjs" run --shell ${shell}`;
  if (SIMPLE.test(cmd)) return `${base} -- ${cmd}`;
  const oneLine = cmd.replace(/[\r\n]+/g, ' ').trim();
  return `${base} --b64 ${Buffer.from(cmd, 'utf8').toString('base64')} # ${oneLine}`;
}

// A --b64 wrapper is only legitimate if it is what wrapCommand would produce
// for a verbose command; anything else could hide a command from review.
function checkWrapped(c) {
  const m = /--b64\s+([A-Za-z0-9+/=]+)/.exec(c);
  if (!m) return { kind: 'wrapped' };
  const inner = Buffer.from(m[1], 'base64').toString('utf8');
  const comment = /\s#\s(.*)$/.exec(c);
  const honest = !comment || comment[1].trim() === inner.replace(/[\r\n]+/g, ' ').trim();
  return honest && classifyCommand(inner).kind === 'verbose' ? { kind: 'wrapped' } : { kind: 'suspicious', inner };
}

export function classifyCommand(cmd) {
  const c = String(cmd);
  if (/tokenkit[\\/]tk\.mjs/.test(c)) return checkWrapped(c);
  if (!PIPED_OR_REDIRECTED.test(c)) {
    for (const r of BOUNDED) {
      if (r.re.test(c) && !r.ok.test(c)) return { kind: 'unbounded', hint: r.hint, soft: !!r.soft };
    }
  }
  if (READERS.test(c)) {
    const paths = c.replace(READERS, '').split(/\s+/).filter((t) => t && !t.startsWith('-'));
    return { kind: 'read', paths };
  }
  if (PIPED_OR_REDIRECTED.test(c) || LONG_RUNNING.test(c)) return { kind: 'other' };
  if (VERBOSE.some((re) => re.test(c))) return { kind: 'verbose' };
  return { kind: 'other' };
}

export function blockedPath(path, guard) {
  const p = String(path).replace(/\\/g, '/');
  if (guard.allowPaths.some((s) => new RegExp(s).test(p))) return null;
  return guard.blockPaths.find((s) => new RegExp(s, 'i').test(p)) ?? null;
}
