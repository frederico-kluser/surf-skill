// Key discovery for library mode.
// Priority (each level can contribute; results merged + deduped):
//   1. Explicit opts (opts.tavilyKey / opts.tavilyKeys / parallel*)
//   2. process.env (TAVILY_API_KEYS comma-separated + TAVILY_API_KEY)
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

/**
 * Resolve API keys for both providers using the discovery hierarchy.
 *
 * @param {object} opts
 * @param {string|string[]} [opts.tavilyKey] - single key or array
 * @param {string[]} [opts.tavilyKeys] - array (alias)
 * @param {string|string[]} [opts.parallelKey] - single or array
 * @param {string[]} [opts.parallelKeys] - array (alias)
 * @param {boolean} [opts.skipDotenv=false] - skip .env scanning
 * @param {boolean} [opts.skipConfigFile=false] - skip ~/.config/surf/keys.json
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {Promise<{tavily: string[], parallel: string[]}>}
 */
export async function discoverKeys(opts = {}) {
  const cwd = opts.cwd || process.cwd();

  // Level 1: explicit
  const explicitTavily = [
    ...arrayify(opts.tavilyKey),
    ...arrayify(opts.tavilyKeys),
  ];
  const explicitParallel = [
    ...arrayify(opts.parallelKey),
    ...arrayify(opts.parallelKeys),
  ];

  // Level 2: process.env
  const envTavily = [
    ...splitCsv(process.env.TAVILY_API_KEYS),
    process.env.TAVILY_API_KEY,
  ].filter(Boolean);
  const envParallel = [
    ...splitCsv(process.env.PARALLEL_API_KEYS),
    process.env.PARALLEL_API_KEY,
  ].filter(Boolean);

  // Level 3: .env file
  let dotenvTavily = [];
  let dotenvParallel = [];
  if (!opts.skipDotenv) {
    const env = await loadDotenv(cwd);
    dotenvTavily = [
      ...splitCsv(env.TAVILY_API_KEYS),
      env.TAVILY_API_KEY,
    ].filter(Boolean);
    dotenvParallel = [
      ...splitCsv(env.PARALLEL_API_KEYS),
      env.PARALLEL_API_KEY,
    ].filter(Boolean);
  }

  // Level 4: ~/.config/surf/keys.json (only if nothing yet from 1-3)
  let cfgTavily = [];
  let cfgParallel = [];
  const noneSoFarTavily = !explicitTavily.length && !envTavily.length && !dotenvTavily.length;
  const noneSoFarParallel = !explicitParallel.length && !envParallel.length && !dotenvParallel.length;
  if (!opts.skipConfigFile && (noneSoFarTavily || noneSoFarParallel)) {
    try {
      const state = await loadState();
      if (noneSoFarTavily) cfgTavily = state.tavily.keys || [];
      if (noneSoFarParallel) cfgParallel = state.parallel.keys || [];
    } catch {}
  }

  return {
    tavily: [...new Set([...explicitTavily, ...envTavily, ...dotenvTavily, ...cfgTavily])],
    parallel: [...new Set([...explicitParallel, ...envParallel, ...dotenvParallel, ...cfgParallel])],
  };
}

/**
 * Build an in-memory state object that the dispatch layer can use directly
 * without touching ~/.config/surf/keys.json.
 */
export async function buildInMemoryState(opts = {}) {
  const { tavily, parallel } = await discoverKeys(opts);
  return {
    schema_version: 1,
    tavily: { keys: tavily, current: 0, burned: [] },
    parallel: { keys: parallel, current: 0, burned: [] },
    last_ok_provider: null,
    _inMemory: true,
  };
}
