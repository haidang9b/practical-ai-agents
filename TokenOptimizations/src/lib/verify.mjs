import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { loadConfig } from './config.mjs';
import { listFiles, SKIP_DIRS } from './repomap.mjs';
import { runCommand } from './run.mjs';

// Every separate check the agent runs is one more model call, and each call
// re-sends the whole conversation. `tk verify` runs all of a project's standard
// checks in ONE call and prints one compact block per check. A repo may hold
// several projects (src/Frontend + src/Backend, or a folder of repos): each is
// checked in its own folder, and --in narrows the run to the one that changed.

const NODE_CHECKS = [
  ['typecheck', ['typecheck', 'type-check', 'tsc', 'check-types', 'types']],
  ['lint', ['lint']],
  ['test', ['test', 'test:unit', 'unit']],
  ['build', ['build']]
];

// Manifests deeper than this belong to packages inside a project, not to projects.
const MAX_DEPTH = 4;
const MARKER = /^(package\.json|pyproject\.toml|pytest\.ini|setup\.py|go\.mod|Cargo\.toml|.+\.(slnx?|csproj|fsproj))$/;
const SLN = /\.slnx?$/;
const PROJ = /\.(cs|fs)proj$/;

function pm(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const parentOf = (dir) => (dir === '.' ? null : dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '.');
const norm = (dir) => String(dir).replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '') || '.';
const within = (dir, base) => base === '.' || dir === base || dir.startsWith(`${base}/`);
const quote = (f) => (/\s/.test(f) ? `"${f}"` : f);

// Folders with a project manifest, minus what an ancestor already covers:
// projects under a solution, packages of a JS or Cargo workspace.
export function findProjects(root) {
  const dirs = new Map();
  for (const p of listFiles(root)) {
    const segs = p.split('/');
    const name = segs.pop();
    if (segs.length > MAX_DEPTH || !MARKER.test(name) || segs.some((s) => SKIP_DIRS.has(s))) continue;
    const dir = segs.join('/') || '.';
    (dirs.get(dir) ?? dirs.set(dir, []).get(dir)).push(name);
  }
  const ancestorHas = (dir, test) => {
    for (let d = parentOf(dir); d !== null; d = parentOf(d)) if (test(d, dirs.get(d) ?? [])) return true;
    return false;
  };
  const jsWorkspace = (d, names) => existsSync(join(root, d, 'pnpm-workspace.yaml'))
    || (names.includes('package.json') && /"workspaces"\s*:/.test(read(join(root, d, 'package.json'))));
  const cargoWorkspace = (d, names) => names.includes('Cargo.toml') && /^\[workspace\]/m.test(read(join(root, d, 'Cargo.toml')));

  const projects = [];
  const order = [...dirs.keys()].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
  for (const dir of order) {
    const names = dirs.get(dir);
    const kept = names.filter((n) => {
      if (SLN.test(n) || PROJ.test(n)) {
        if (PROJ.test(n) && names.some((m) => SLN.test(m))) return false;
        return !ancestorHas(dir, (_, ns) => ns.some((m) => SLN.test(m)));
      }
      if (n === 'package.json') return !ancestorHas(dir, jsWorkspace);
      if (n === 'Cargo.toml') return !ancestorHas(dir, cargoWorkspace);
      return true;
    });
    if (kept.length) projects.push({ dir, names: kept });
  }
  return projects;
}

function checksIn(root, { dir, names }, { build }) {
  const abs = join(root, dir);
  const checks = [];
  const add = (label, cmd) => checks.push({ label, cmd, dir, name: dir === '.' ? label : `${dir}:${label}` });
  if (names.includes('package.json')) {
    let scripts = {};
    try { scripts = JSON.parse(read(join(abs, 'package.json'))).scripts || {}; } catch { /* unreadable */ }
    const run = pm(abs);
    for (const [label, candidates] of NODE_CHECKS) {
      if (label === 'build' && !build) continue;
      const name = candidates.find((n) => typeof scripts[n] === 'string' && !/--watch|\bwatch\b/.test(scripts[n]));
      if (name) add(label, `${run} run ${name}`);
    }
  }
  if (names.some((n) => /^(pyproject\.toml|pytest\.ini|setup\.py)$/.test(n))) add('test', 'python -m pytest -q');
  if (names.includes('go.mod')) { add('vet', 'go vet ./...'); add('test', 'go test ./...'); }
  if (names.includes('Cargo.toml')) { add('check', 'cargo check -q'); add('test', 'cargo test -q'); }
  // Named explicitly: `dotnet build` refuses a folder holding more than one project or solution.
  for (const f of names.filter((n) => SLN.test(n) || PROJ.test(n))) {
    add('build', `dotnet build ${quote(f)} -v q`);
    add('test', `dotnet test ${quote(f)} -v q --no-build`);
  }
  return checks;
}

export function detectChecks(root, { build = false } = {}) {
  const configured = loadConfig().verify.checks;
  if (configured.length) {
    return configured.map((c) => ({ label: String(c.label ?? c.cmd).split(':').pop(), name: c.label ?? c.cmd, cmd: c.cmd, dir: norm(c.cwd ?? '.') }));
  }
  return findProjects(root).flatMap((p) => checksIn(root, p, { build }));
}

// --in <dir>: the projects inside dir, or else the project that contains it.
function narrow(checks, target) {
  const inside = checks.filter((c) => within(c.dir, target));
  if (inside.length) return inside;
  const owner = checks.map((c) => c.dir).filter((d) => within(target, d)).sort((a, b) => b.length - a.length)[0];
  return owner === undefined ? [] : checks.filter((c) => c.dir === owner);
}

export async function verify(root, { build = false, only, inDir } = {}) {
  let checks = detectChecks(root, { build });
  if (inDir) checks = narrow(checks, norm(isAbsolute(inDir) ? relative(root, inDir) : inDir));
  if (only?.length) checks = checks.filter((c) => only.includes(c.label));
  if (!checks.length) {
    console.log(`[tk] verify: no checks found${inDir ? ` for ${inDir}` : ''} (looked for package.json scripts typecheck/lint/test, pytest, go, cargo and dotnet in the repo and its subfolders). List them under "verify": { "checks": [...] } in .tokenkit/config.json.`);
    return 2;
  }
  const results = [];
  for (const c of checks) {
    // Tests that reuse a failed build would only repeat its errors.
    if (/--no-build/.test(c.cmd) && results.some((r) => r.dir === c.dir && r.label === 'build' && r.code !== 0)) {
      results.push({ ...c, code: null });
      continue;
    }
    console.log(`=== ${c.name}: ${c.cmd}`);
    const code = await runCommand([c.cmd], { quietOk: true, cwd: join(root, c.dir) });
    results.push({ ...c, code });
  }
  console.log(`[tk] verify: ${results.map((r) => `${r.name} ${r.code === null ? 'SKIPPED (build failed)' : r.code === 0 ? 'OK' : 'FAILED'}`).join(' · ')}`);
  return results.some((r) => r.code !== 0) ? 1 : 0;
}
