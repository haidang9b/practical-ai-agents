#!/usr/bin/env node
import { join } from 'node:path';
import { compress } from './lib/compress.mjs';
import { KIT_DIR, loadConfig } from './lib/config.mjs';
import { audit, formatAudit } from './lib/budget.mjs';
import { install, uninstall } from './lib/install.mjs';
import { writeMap } from './lib/repomap.mjs';
import { report } from './lib/report.mjs';
import { runCommand } from './lib/run.mjs';
import { verify } from './lib/verify.mjs';
import { expandSpec, LEGEND } from './lib/spec.mjs';
import { formatHints, locate } from './lib/locate.mjs';
import { doctor, formatDoctor } from './lib/doctor.mjs';
import { formatCompare, formatUsage, usageReport } from './lib/usage.mjs';
import { fmtTokens } from './lib/tokens.mjs';

const HELP = `tokenkit (tk) — keep Copilot's context small

  tk run [--raw] -- <cmd...>    run a command, print compressed output (full log: the run-*.log named in the header)
  tk verify [--build] [--only typecheck,test] [--in <dir>]
                                ALL checks (typecheck, lint, tests) in ONE call: fewer agent steps.
                                Finds every project (src/Frontend, src/Backend/*.sln, nested repos);
                                --in limits the run to the project(s) in or around <dir>
  tk filter [--exit N]          compress stdin:  <cmd> 2>&1 | node .tokenkit/tk.mjs filter
  tk map [--print]              (re)build .tokenkit/repomap.md, the grep-able symbol index
  tk spec "<taskspec>"          expand TaskSpec shorthand into a full prompt  (--legend: print legend)
  tk locate "<plain request>"   show the location hints the prompt hook would add (--why: scoring detail)
  tk budget [dir] [--ci]        audit always-on Copilot context; --ci exits 1 when over budget
  tk report [--days N]          tokens kept out of context, biggest tool outputs
  tk usage [folder] [--json]    VS Code's recorded chat usage for a folder (works without tokenkit installed)
  tk usage <folderA> <folderB>  side-by-side comparison of the latest session in each
  tk doctor [repo]              check an installed repo: runs each hook with sample input; exit 1 on failure
  tk uninstall <repo>... [--dry-run]   remove what install added (keeps files you edited)
  tk install <repo>... [--force] [--dry-run]
                                install runtime (.tokenkit/), hooks, skills, agents, prompts into repos`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const repoRoot = () => join(KIT_DIR, '..');

async function main() {
  switch (cmd) {
    case 'run': {
      const raw = flag('--raw');
      const shell = opt('--shell');
      const b64 = opt('--b64');
      if (argv[0] === '--') argv.shift();
      const args = b64 ? [Buffer.from(b64, 'base64').toString('utf8')] : argv;
      return runCommand(args, { raw, shell });
    }
    case 'verify': {
      const build = flag('--build');
      const only = opt('--only');
      const inDir = opt('--in');
      process.chdir(repoRoot());
      return verify(repoRoot(), { build, only: only ? only.split(',') : undefined, inDir });
    }
    case 'filter': {
      const exit = opt('--exit');
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      const r = compress(Buffer.concat(chunks).toString('utf8'), { ...loadConfig().run, exitCode: exit === undefined ? 1 : Number(exit) });
      if (r.notes.length) process.stdout.write(`[tk] ${r.notes.join('; ')}\n`);
      process.stdout.write(r.text + '\n');
      return 0;
    }
    case 'map': {
      const r = writeMap(repoRoot(), join(KIT_DIR, 'repomap.md'));
      if (flag('--print')) process.stdout.write(r.text);
      else console.log(`.tokenkit/repomap.md: ${r.files} files, ~${fmtTokens(r.tokens)} tokens${r.overview ? ' (grep-only; folder overview in .tokenkit/areas.md)' : ''}`);
      return 0;
    }
    case 'spec': {
      if (flag('--legend')) { console.log(LEGEND); return 0; }
      if (!argv.length) { console.error('usage: tk spec "fix @src/a.ts#login null user crash +test >diff"'); return 2; }
      const { text, spec } = expandSpec(argv.join(' '), repoRoot());
      console.log(text);
      if (spec.unknown.length) console.error(`[tk] unrecognized: ${spec.unknown.join(' ')}`);
      return 0;
    }
    case 'locate': {
      const why = flag('--why');
      if (!argv.length) { console.error('usage: tk locate "fix the discount being applied twice"'); return 2; }
      const r = locate(argv.join(' '), repoRoot(), loadConfig().prompt);
      if (why) console.log(`cues: ${JSON.stringify(r.cues)}`);
      if (!r.hints.length) { console.log(`(no hint injected: ${r.reason})`); return 0; }
      console.log(formatHints(r.hints));
      if (why) for (const h of r.hints) console.log(`  score ${h.score}  ${h.path}${h.range}  matched: ${h.why.join(', ')}`);
      return 0;
    }
    case 'budget': {
      const ci = flag('--ci');
      const r = audit(argv[0] ?? repoRoot());
      console.log(formatAudit(r));
      return ci && r.total > r.budget ? 1 : 0;
    }
    case 'uninstall': {
      const dryRun = flag('--dry-run');
      if (!argv[0]) { console.error('usage: tk uninstall <repo-path>... [--dry-run]'); return 2; }
      if (dryRun) console.log('DRY RUN: nothing is removed; this is what uninstall would do.');
      for (const repo of argv) {
        console.log(`== ${repo}`);
        for (const line of uninstall(repo, { dryRun })) console.log(line);
      }
      if (!dryRun) console.log('\nNext: review with git status, commit, and reload VS Code.');
      return 0;
    }
    case 'usage': {
      const json = flag('--json');
      if (argv.length === 2) {
        const [a, b] = argv.map((f) => usageReport(f));
        console.log(json ? JSON.stringify([a, b], null, 2) : formatCompare(a, b));
        return 0;
      }
      const r = usageReport(argv[0] ?? process.cwd());
      console.log(json ? JSON.stringify(r, null, 2) : formatUsage(r));
      return 0;
    }
    case 'doctor': {
      const root = argv[0] ?? repoRoot();
      const r = doctor(root);
      console.log(formatDoctor(root, r));
      return r.failed ? 1 : 0;
    }
    case 'report':
      console.log(report({ days: Number(opt('--days') ?? 7) }));
      return 0;
    case 'install': {
      const dryRun = flag('--dry-run');
      const force = flag('--force');
      if (!argv[0]) { console.error('usage: tk install <repo-path>... [--force] [--dry-run]'); return 2; }
      if (dryRun) console.log('DRY RUN: nothing is written; this is what install would do.');
      for (const repo of argv) {
        console.log(`== ${repo}`);
        for (const line of install(repo, { dryRun, force })) console.log(line);
      }
      if (!dryRun) console.log('\nNext: run  node .tokenkit/tk.mjs doctor  inside the repo, commit .github/ and .tokenkit/, then reload VS Code (see docs/INSTALL.md).');
      return 0;
    }
    default:
      console.log(HELP);
      return cmd && cmd !== 'help' && cmd !== '--help' ? 2 : 0;
  }
}

main().then((code) => { process.exitCode = code ?? 0; }, (e) => { console.error(`[tk] ${e.message}`); process.exitCode = 1; });
