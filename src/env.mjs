// Key discovery for library mode.
// Priority (each level can contribute; results merged + deduped):
//   1. Explicit opts (opts.tavilyKey / opts.tavilyKeys / parallel* / brave*)
//   2. process.env  (TAVILY_API_KEYS comma-separated + TAVILY_API_KEY,
//                    PARALLEL_API_KEYS + PARALLEL_API_KEY,
//                    BRAVE_API_KEYS + BRAVE_API_KEY,
//                    OPENROUTER_API_KEYS + OPENROUTER_API_KEY)
//   3. .env file at process.cwd() (lightweight regex parser, no dotenv dep)
//   4. ~/.config/surf/keys.json (CLI persistent store, fallback only)

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { loadState, PROVIDERS } from './lib/state.mjs';

// provider name -> env-var prefix. Kept explicit (rather than uppercasing the
// provider name) so a future provider whose slug differs from its env prefix
// doesn't silently break key discovery.
const ENV_BASE = {
  tavily: 'TAVILY',
  parallel: 'PARALLEL',
  brave: 'BRAVE',
  openrouter: 'OPENROUTER',
};

const ENV_FILE_CACHE = new Map();

async function loadDotenv(dir) {
  if (ENV_FILE_CACHE.has(dir)) return ENV_FILE_CACHE.get(dir);
  const p = path.join(dir, '.env');
  const out = {};
  if (existsSync(p)) {
    try {
      const txt = await fs.readFile(p, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"#]*?)"?\s*(?:#.*)?$/);
        if (m) out[m[1]] = m[2].trim();
      }
    } catch {}
  }
  ENV_FILE_CACHE.set(dir, out);
  return out;
}

function splitCsv(s) {
  return typeof s === 'string'
    ? s.split(',').map(x => x.trim()).filter(Boolean)
    : [];
}

function arrayify(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

function readFromObject(obj, base) {
  // base = 'TAVILY' | 'PARALLEL' | 'BRAVE' | 'OPENROUTER'
  return [
    ...splitCsv(obj[`${base}_API_KEYS`]),
    obj[`${base}_API_KEY`],
  ].filter(Boolean);
}

// opts.tavilyKey / opts.tavilyKeys — camelCase option names per provider.
function explicitFor(opts, provider) {
  return [...arrayify(opts[`${provider}Key`]), ...arrayify(opts[`${provider}Keys`])];
}

/**
 * Resolve API keys for every provider using the discovery hierarchy.
 *
 * @param {object} opts
 * @param {string|string[]} [opts.tavilyKey|opts.tavilyKeys]
 * @param {string|string[]} [opts.parallelKey|opts.parallelKeys]
 * @param {string|string[]} [opts.braveKey|opts.braveKeys]
 * @param {string|string[]} [opts.openrouterKey|opts.openrouterKeys]
 * @param {boolean} [opts.skipDotenv=false]
 * @param {boolean} [opts.skipConfigFile=false]
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {Promise<{tavily: string[], parallel: string[], brave: string[], openrouter: string[]}>}
 */
export async function discoverKeys(opts = {}) {
  const cwd = opts.cwd || process.cwd();

  const explicit = {};
  const env = {};
  const dotenv = {};
  const cfg = {};

  const parsedDotenv = opts.skipDotenv ? {} : await loadDotenv(cwd);

  for (const p of PROVIDERS) {
    const base = ENV_BASE[p] || p.toUpperCase();
    explicit[p] = explicitFor(opts, p);                        // Level 1
    env[p] = readFromObject(process.env, base);                // Level 2
    dotenv[p] = opts.skipDotenv ? [] : readFromObject(parsedDotenv, base); // Level 3
    cfg[p] = [];
  }

  // Level 4: ~/.config/surf/keys.json — consulted per provider, and only when
  // levels 1-3 produced nothing for that provider.
  if (!opts.skipConfigFile) {
    const needCfg = (p) => !explicit[p].length && !env[p].length && !dotenv[p].length;
    if (PROVIDERS.some(needCfg)) {
      try {
        const state = await loadState();
        for (const p of PROVIDERS) {
          if (needCfg(p)) cfg[p] = (state[p] && state[p].keys) || [];
        }
      } catch {}
    }
  }

  const out = {};
  for (const p of PROVIDERS) {
    out[p] = [...new Set([...explicit[p], ...env[p], ...dotenv[p], ...cfg[p]])];
  }
  return out;
}

/**
 * Build an in-memory state object that the dispatch layer can use directly
 * without touching ~/.config/surf/keys.json.
 */
export async function buildInMemoryState(opts = {}) {
  const discovered = await discoverKeys(opts);
  const state = { schema_version: 1, last_ok_provider: null, _inMemory: true };
  for (const p of PROVIDERS) {
    state[p] = { keys: discovered[p] || [], current: 0, burned: [], cooldowns: [] };
  }
  return state;
}
