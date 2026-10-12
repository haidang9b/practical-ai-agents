import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Directory holding tk.mjs. In an installed repo this is <repo>/.tokenkit/.
export const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOG_DIR = process.env.TOKENKIT_LOG_DIR || join(KIT_DIR, 'logs');

export const DEFAULTS = {
  run: {
    maxLines: 80,        // cap on head, tail and context lines returned to the model
    maxErrorLines: 150,  // separate budget for error lines and their file:line locations
    headLines: 6,        // always keep the first N lines (command banner, config)
    tailLines: 20,       // always keep the last N lines (summaries live here)
    successTail: 8,      // on exit 0, keep only this much tail
    context: 2,          // lines kept around each error line
    timeoutSec: 0,       // 0 = no timeout
    keepLogs: 10,
    noise: [],           // extra regexes (strings) for lines to drop
    errors: []           // extra regexes (strings) for lines to always keep
  },
  guard: {
    // verbose build/test/install commands: auto | rewrite | deny | off
    //   auto = rewrite in place, falling back to deny if the harness ignores rewrites
    commands: 'auto',
    reads: 'deny',       // lockfiles, generated files, huge whole-file reads: deny | off
    bounded: 'deny',     // unbounded git log / recursive listings / logs: deny | off
    shell: 'auto',       // shell for rewritten commands: auto | bash | powershell (set bash if VS Code's terminal is Git Bash)
    maxReadKB: 48,       // whole-file reads above this need a line range
    blockPaths: [
      '(^|/)(node_modules|dist|build|target|obj|coverage|\\.next|\\.nuxt|\\.venv|venv|__pycache__|\\.gradle|\\.terraform)/',
      '(^|/)(package-lock\\.json|npm-shrinkwrap\\.json|yarn\\.lock|pnpm-lock\\.yaml|bun\\.lockb|poetry\\.lock|Pipfile\\.lock|uv\\.lock|Cargo\\.lock|composer\\.lock|Gemfile\\.lock|go\\.sum|packages\\.lock\\.json)$',
      '\\.(min\\.js|min\\.css|map|snap|log|lcov|pyc|class|dll|exe|so|dylib|png|jpe?g|gif|ico|pdf|zip|gz|woff2?)$'
    ],
    allowPaths: []
  },
  post: {
    minTokens: 1500,     // tool outputs above this get compressed (Copilot CLI only)
    otherHead: 60,       // non-shell tools: keep first N lines ...
    otherTail: 15        // ... and last N lines
  },
  prompt: {
    hints: 'on',         // plain-language prompts get repo-map location hints: on | off
    maxHints: 5,
    minScore: 5          // 10 = exact identifier/file name, 8 = 2+ name words, 5 = one whole-name word
  },
  map: {
    maxTokens: 4000,     // above this the map is grep-only and .tokenkit/areas.md gives a folder overview
    maxAgeMinutes: 60,
    maxFileKB: 256,      // bigger files are listed by path only
    exclude: []
  },
  verify: {
    // Explicit checks instead of auto-detection, e.g.
    // [{ "label": "api:test", "cwd": "src/Backend", "cmd": "dotnet test Contoso.sln -v q" }]
    checks: []
  },
  budget: {
    alwaysOnTokens: 1200,
    skillDescriptionChars: 300
  }
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = merge(base[k], v);
  return out;
}

let cached;
export function loadConfig() {
  if (cached) return cached;
  let user = {};
  try {
    user = JSON.parse(readFileSync(process.env.TOKENKIT_CONFIG || join(KIT_DIR, 'config.json'), 'utf8'));
  } catch { /* no config.json: defaults only */ }
  return (cached = merge(DEFAULTS, user));
}
