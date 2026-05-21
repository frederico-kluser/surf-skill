// Key discovery for library mode.
// Priority (each level can contribute; results merged + deduped):
//   1. Explicit opts (opts.tavilyKey / opts.tavilyKeys / parallel* / brave*)
//   2. process.env  (TAVILY_API_KEYS comma-separated + TAVILY_API_KEY,
//                    PARALLEL_API_KEYS + PARALLEL_API_KEY,
//                    BRAVE_API_KEYS + BRAVE_API_KEY)
//   3. .env file at process.cwd() (lightweight regex parser, no dotenv dep)
//   4. ~/.config/surf/keys.json (CLI persistent store, fallback only)

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { loadState } from './lib/state.mjs';

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
  // base = 'TAVILY' | 'PARALLEL' | 'BRAVE'
  return [
    ...splitCsv(obj[`${base}_API_KEYS`]),
    obj[`${base}_API_KEY`],
  ].filter(Boolean);
}

/**
 * Resolve API keys for all 3 providers using the discovery hierarchy.
 *
 * @param {object} opts
 * @param {string|string[]} [opts.tavilyKey|opts.tavilyKeys]
 * @param {string|string[]} [opts.parallelKey|opts.parallelKeys]
 * @param {string|string[]} [opts.braveKey|opts.braveKeys]
 * @param {boolean} [opts.skipDotenv=false]
 * @param {boolean} [opts.skipConfigFile=false]
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {Promise<{tavily: string[], parallel: string[], brave: string[]}>}
 */
export async function discoverKeys(opts = {}) {
  const cwd = opts.cwd || process.cwd();

  // Level 1: explicit
  const explicit = {
    tavily:   [...arrayify(opts.tavilyKey),   ...arrayify(opts.tavilyKeys)],
    parallel: [...arrayify(opts.parallelKey), ...arrayify(opts.parallelKeys)],
    brave:    [...arrayify(opts.braveKey),    ...arrayify(opts.braveKeys)],
  };

  // Level 2: process.env
  const env = {
    tavily:   readFromObject(process.env, 'TAVILY'),
    parallel: readFromObject(process.env, 'PARALLEL'),
    brave:    readFromObject(process.env, 'BRAVE'),
  };

  // Level 3: .env file
  let dotenv = { tavily: [], parallel: [], brave: [] };
  if (!opts.skipDotenv) {
    const parsed = await loadDotenv(cwd);
    dotenv = {
      tavily:   readFromObject(parsed, 'TAVILY'),
      parallel: readFromObject(parsed, 'PARALLEL'),
      brave:    readFromObject(parsed, 'BRAVE'),
    };
  }

  // Level 4: ~/.config/surf/keys.json (per-provider, only if 1-3 are empty
  // for that provider)
  const cfg = { tavily: [], parallel: [], brave: [] };
  if (!opts.skipConfigFile) {
    const needCfg = (p) => !explicit[p].length && !env[p].length && !dotenv[p].length;
    if (needCfg('tavily') || needCfg('parallel') || needCfg('brave')) {
      try {
        const state = await loadState();
        if (needCfg('tavily'))   cfg.tavily   = state.tavily.keys   || [];
        if (needCfg('parallel')) cfg.parallel = state.parallel.keys || [];
        if (needCfg('brave'))    cfg.brave    = state.brave.keys    || [];
      } catch {}
    }
  }

  return {
    tavily:   [...new Set([...explicit.tavily,   ...env.tavily,   ...dotenv.tavily,   ...cfg.tavily])],
    parallel: [...new Set([...explicit.parallel, ...env.parallel, ...dotenv.parallel, ...cfg.parallel])],
    brave:    [...new Set([...explicit.brave,    ...env.brave,    ...dotenv.brave,    ...cfg.brave])],
  };
}

/**
 * Build an in-memory state object that the dispatch layer can use directly
 * without touching ~/.config/surf/keys.json.
 */
export async function buildInMemoryState(opts = {}) {
  const { tavily, parallel, brave } = await discoverKeys(opts);
  return {
    schema_version: 1,
    tavily:   { keys: tavily,   current: 0, burned: [] },
    parallel: { keys: parallel, current: 0, burned: [] },
    brave:    { keys: brave,    current: 0, burned: [] },
    last_ok_provider: null,
    _inMemory: true,
  };
}
