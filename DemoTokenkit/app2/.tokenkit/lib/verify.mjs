import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from './run.mjs';

// Every separate check the agent runs is one more model call, and each call
// re-sends the whole conversation. `tk verify` runs all of a project's standard
// checks in ONE call and prints one compact block per check.

const NODE_CHECKS = [
  ['typecheck', ['typecheck', 'type-check', 'tsc', 'check-types', 'types']],
  ['lint', ['lint']],
  ['test', ['test', 'test:unit', 'unit']],
  ['build', ['build']]
];

function pm(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

export function detectChecks(root, { build = false } = {}) {
  const checks = [];
  const pkgFile = join(root, 'package.json');
  if (existsSync(pkgFile)) {
    let scripts = {};
    try { scripts = JSON.parse(readFileSync(pkgFile, 'utf8')).scripts || {}; } catch { /* unreadable */ }
    const run = pm(root);
    for (const [label, names] of NODE_CHECKS) {
      if (label === 'build' && !build) continue;
      const name = names.find((n) => typeof scripts[n] === 'string' && !/--watch|\bwatch\b/.test(scripts[n]));
      if (name) checks.push({ label, cmd: `${run} run ${name}` });
    }
    return checks;
  }
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'setup.py'))) {
    checks.push({ label: 'test', cmd: 'python -m pytest -q' });
  } else if (existsSync(join(root, 'go.mod'))) {
    checks.push({ label: 'vet', cmd: 'go vet ./...' }, { label: 'test', cmd: 'go test ./...' });
  } else if (existsSync(join(root, 'Cargo.toml'))) {
    checks.push({ label: 'check', cmd: 'cargo check -q' }, { label: 'test', cmd: 'cargo test -q' });
  } else {
    const sln = ['.sln', '.csproj', '.fsproj'].some((ext) => {
      try { return readdirSync(root).some((f) => f.endsWith(ext)); } catch { return false; }
    });
    if (sln) checks.push({ label: 'build', cmd: 'dotnet build -v q' }, { label: 'test', cmd: 'dotnet test -v q --no-build' });
  }
  return checks;
}

export async function verify(root, { build = false, only } = {}) {
  let checks = detectChecks(root, { build });
  if (only?.length) checks = checks.filter((c) => only.includes(c.label));
  if (!checks.length) {
    console.log('[tk] verify: no checks found (looked for package.json scripts typecheck/lint/test, pytest, go, cargo, dotnet).');
    return 2;
  }
  const results = [];
  for (const c of checks) {
    console.log(`=== ${c.label}: ${c.cmd}`);
    const code = await runCommand([c.cmd], { logRef: 'own', quietOk: true });
    results.push({ ...c, code });
  }
  const failed = results.filter((r) => r.code !== 0);
  console.log(`[tk] verify: ${results.map((r) => `${r.label} ${r.code === 0 ? 'OK' : 'FAILED'}`).join(' · ')}`);
  return failed.length ? 1 : 0;
}
