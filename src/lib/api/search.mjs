// Library wrapper for `search`. Wraps dispatch + key discovery.

import { dispatch } from '../dispatch.mjs';
import { mapPool } from '../pool.mjs';
import { buildInMemoryState } from '../../env.mjs';
import { setSilent } from '../progress.mjs';

/**
 * Web search.
 *
 * @param {string|string[]} query - single query or array (batch)
 * @param {object} [opts]
 * @param {string|string[]} [opts.tavilyKey|opts.tavilyKeys]
 * @param {string|string[]} [opts.parallelKey|opts.parallelKeys]
 * @param {'tavily'|'parallel'} [opts.provider] - force a provider (no fallback)
 * @param {'basic'|'advanced'|'fast'} [opts.depth='advanced']
 * @param {number} [opts.max=5]
 * @param {string} [opts.topic] - 'general' | 'news' | 'finance'
 * @param {string} [opts.time] - 'day' | 'week' | 'month' | 'year'
 * @param {string|string[]} [opts.domains]
 * @param {string|string[]} [opts.excludeDomains]
 * @param {string} [opts.country]
 * @param {boolean|string} [opts.answer]
 * @param {boolean|string} [opts.raw]
 * @param {boolean} [opts.noCache=false]
 * @param {boolean} [opts.quiet=true] - silence stderr progress logs (library default)
 * @returns {Promise<object>} normalized envelope { provider, operation, data, usage, latency_ms, raw }
 */
export async function search(query, opts = {}) {
  if (opts.quiet !== false) setSilent(true);

  const queries = Array.isArray(query) ? query : [query];
  if (queries.length === 0 || queries.some(q => typeof q !== 'string' || !q.trim())) {
    throw new Error('search: query must be a non-empty string or array of strings');
  }

  const state = await buildInMemoryState(opts);

  if (queries.length === 1) {
    return dispatch('search', buildArgs(queries[0], opts), buildFlags(opts), { state });
  }

  // Batch: run sequentially, return array of envelopes
  const batches = [];
  for (const q of queries) {
    try {
      const env = await dispatch('search', buildArgs(q, opts), buildFlags(opts), { state });
      batches.push({ query: q, ok: true, envelope: env });
    } catch (e) {
      batches.push({ query: q, ok: false, error: { code: e.code || 'Error', message: e.message } });
    }
  }
  return {
    operation: 'search-batch',
    data: { batches },
    summary: {
      total: queries.length,
      succeeded: batches.filter(b => b.ok).length,
      failed: batches.filter(b => !b.ok).length,
    },
  };
}

/**
 * Parallel web search — fans out many queries concurrently with a bounded
 * worker pool (partial-failure tolerant). Unlike `search([...])` (which runs
 * sequentially), this runs up to `opts.concurrency` (default 6) at once.
 *
 * @param {Array<string|{q?:string,query?:string,id?:string,sub?:string}>} queries
 * @param {object} [opts] - same as search(), plus:
 * @param {number} [opts.concurrency=6]
 * @param {boolean} [opts.noBudget=true] - library default: no self-budget abort
 *   (library callers aren't under an agent bash timeout). Set false to re-enable.
 * @returns {Promise<{operation:'search-parallel', data:{batches:Array}, summary:object}>}
 */
export async function searchParallel(queries, opts = {}) {
  if (opts.quiet !== false) setSilent(true);

  const list = (Array.isArray(queries) ? queries : [queries])
    .map((q, i) => (typeof q === 'string'
      ? { id: `q${i + 1}`, q, sub: null }
      : { id: (q && q.id) || `q${i + 1}`, q: q && (q.q || q.query), sub: (q && q.sub) || null }))
    .filter(it => typeof it.q === 'string' && it.q.trim());
  if (!list.length) throw new Error('searchParallel: need at least one non-empty query');

  const concurrency = Math.max(1, Math.min(Math.floor(Number(opts.concurrency) || 6), 16));
  const state = await buildInMemoryState(opts);
  const flags = { ...buildFlags(opts), 'no-budget': opts.noBudget !== false };

  const settled = await mapPool(list, concurrency, (item) =>
    dispatch('search', buildArgs(item.q, opts), flags, { state })
  );

  const batches = list.map((item, i) => {
    const r = settled[i];
    if (r && r.ok) return { id: item.id, sub: item.sub, query: item.q, ok: true, envelope: r.value };
    const e = (r && r.error) || {};
    return { id: item.id, sub: item.sub, query: item.q, ok: false, error: { code: e.code || e.name || 'Error', message: e.message || 'unknown error' } };
  });

  return {
    operation: 'search-parallel',
    data: { batches },
    summary: {
      total: list.length,
      succeeded: batches.filter(b => b.ok).length,
      failed: batches.filter(b => !b.ok).length,
      concurrency,
    },
  };
}

function buildArgs(query, opts) {
  return {
    query,
    mode: opts.mode, // 'fast' | 'normal' | 'slow' (per-provider mapping)
    depth: opts.depth || (opts.mode ? undefined : 'advanced'),
    max: opts.max,
    topic: opts.topic,
    time: opts.time,
    startDate: opts.startDate,
    endDate: opts.endDate,
    domains: opts.domains,
    excludeDomains: opts.excludeDomains,
    country: opts.country,
    answer: opts.answer,
    raw: opts.raw,
    images: opts.images,
    auto: opts.auto,
    exactMatch: opts.exactMatch,
    processor: opts.processor,
  };
}

function buildFlags(opts) {
  return {
    provider: opts.provider,
    'no-fallback': opts.noFallback,
    'no-cache': opts.noCache,
    timeout: opts.timeout,
    'confirm-expensive': true, // library callers know what they're doing
  };
}
