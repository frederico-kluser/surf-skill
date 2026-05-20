// Central dispatch: provider+key fallback for every operation. The CLI never
// talks to provider adapters directly — it always goes through dispatch().

import {
  loadState, saveStateAtomic, markBurned, providerHasUsableKey,
  nextUsableKeyIndex, PROVIDERS as PROVIDER_NAMES,
} from './state.mjs';
import { audit, recordUsage } from './audit.mjs';
import { cacheKey, cacheGet, cacheSet } from './cache.mjs';
import { getProvider, capabilityMap, providerFromRequestId } from './providers/index.mjs';
import { guardExpensive } from './cost.mjs';
import { sleep } from './flags.mjs';

const CACHEABLE = new Set(['search', 'extract', 'map']);
const VERSION = '2.0.0';

export class DispatchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
    this.details = details;
  }
}

function buildChain(operation, state, flags) {
  if (operation === 'research-poll') {
    const decoded = providerFromRequestId(flags.__requestId);
    if (!decoded) throw new DispatchError('BAD_REQUEST_ID', `unknown request_id prefix in '${flags.__requestId}'`);
    if (!providerHasUsableKey(state, decoded.provider)) {
      throw new DispatchError(
        'NoUsableKeyForRequestId',
        `request_id belongs to provider '${decoded.provider}', which has no usable keys; run "surf keys add --provider ${decoded.provider} <key>" and retry`
      );
    }
    return { chain: [decoded.provider], pinned: true, decoded };
  }

  if (operation === 'usage') {
    const provider = flags.provider;
    if (!provider) throw new DispatchError('UsageNeedsProvider', `'usage' requires --provider tavily|parallel`);
    if (!providerHasUsableKey(state, provider)) {
      throw new DispatchError('NoUsableKey', `provider '${provider}' has no usable keys`);
    }
    return { chain: [provider], pinned: true };
  }

  const baseChain = capabilityMap[operation];
  if (!Array.isArray(baseChain)) {
    throw new DispatchError('UnknownOperation', `operation '${operation}' is not registered`);
  }

  let chain = baseChain.filter(p => providerHasUsableKey(state, p));

  if (flags.provider) {
    if (!baseChain.includes(flags.provider)) {
      throw new DispatchError('NotCapable',
        `provider '${flags.provider}' does not support '${operation}' (supported: ${baseChain.join(', ')})`);
    }
    if (!providerHasUsableKey(state, flags.provider)) {
      throw new DispatchError('NoUsableKey', `provider '${flags.provider}' has no usable keys for '${operation}'`);
    }
    return { chain: [flags.provider], pinned: true };
  }

  if (chain.length === 0) {
    throw new DispatchError(
      'NoProviderAvailable',
      `operation '${operation}' requires one of [${baseChain.join(', ')}]; run "surf keys add --provider <name> <key>"`
    );
  }

  // Promote last_ok_provider to the front when it is still in the filtered chain.
  if (state.last_ok_provider && chain.includes(state.last_ok_provider)) {
    chain = [state.last_ok_provider, ...chain.filter(x => x !== state.last_ok_provider)];
  }

  if (flags['no-fallback'] || flags.noFallback) {
    return { chain: [chain[0]], pinned: true };
  }

  return { chain, pinned: false };
}

function backoff(attempt) {
  return Math.min(1500 * (attempt + 1) ** 2, 8000);
}

export async function dispatch(operation, args, flags = {}) {
  const state = await loadState();
  let cachedHit = null;
  let cKey = null;

  // Cache lookup (only for cacheable, only when not forced/raw/no-cache).
  if (CACHEABLE.has(operation) && !flags['no-cache'] && !flags['raw-json'] && !flags.provider) {
    cKey = cacheKey('any', operation, args);
    cachedHit = await cacheGet(cKey);
    if (cachedHit) {
      await audit({ op: operation, cache: 'hit', provider: cachedHit.provider });
      await recordUsage({ op: operation, provider: cachedHit.provider, credits: 0, cached: true });
      return cachedHit;
    }
  }

  const { chain, pinned, decoded } = buildChain(operation, state, flags);

  // Cost guard runs AFTER chain build, so NoProviderAvailable and
  // bad-input errors surface before users see a misleading credit warning.
  if (operation !== 'research-poll' && operation !== 'usage') {
    guardExpensive(operation, args, chain, flags);
  }

  const errors = [];

  for (const providerName of chain) {
    const provider = getProvider(providerName);
    if (!provider) {
      errors.push(`${providerName}: provider not registered`);
      continue;
    }
    if (operation !== 'research-poll' && !provider.supports[operation]) {
      errors.push(`${providerName}: does not support '${operation}'`);
      continue;
    }

    let attempted = new Set();
    let providerExhausted = false;

    while (!providerExhausted) {
      const keyIdx = (() => {
        const p = state[providerName];
        if (!p || !p.keys.length) return -1;
        const burnedIdx = new Set(p.burned.map(b => b.index));
        const n = p.keys.length;
        const start = Math.max(0, Math.min(p.current || 0, n - 1));
        for (let off = 0; off < n; off++) {
          const i = (start + off) % n;
          if (attempted.has(i)) continue;
          if (burnedIdx.has(i)) continue;
          return i;
        }
        return -1;
      })();

      if (keyIdx === -1) { providerExhausted = true; break; }
      attempted.add(keyIdx);

      const ctx = {
        key: state[providerName].keys[keyIdx],
        timeout: flags.timeout ? Number(flags.timeout) : undefined,
        version: VERSION,
      };

      const callArgs = operation === 'research-poll' && decoded
        ? { ...args, providerRunId: decoded.providerRunId }
        : args;

      let consecutive5xx = 0;
      let consecutive429 = 0;
      let consecutiveNetwork = 0;
      let success = null;

      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        try {
          const result = await provider[operation](callArgs, ctx);
          success = result;
          break;
        } catch (e) {
          const kind = e.kind || 'caller_4xx';
          await audit({
            op: operation, provider: providerName, key_index: keyIdx,
            kind, status: e.statusCode, message: (e.message || '').slice(0, 200),
          });

          if (kind === 'caller_4xx' || kind === 'not_supported') {
            // Don't retry, don't fallback. Bad input.
            throw e;
          }
          if (kind === 'rate_limit_429') {
            consecutive429++;
            if (attempt < 2) { await sleep(backoff(attempt)); continue; }
            break; // exhausted retries -> next key
          }
          if (kind === 'network') {
            consecutiveNetwork++;
            if (attempt < 2) { await sleep(backoff(attempt) / 2); continue; }
            break; // exhausted retries -> next key
          }
          if (kind === 'auth') {
            markBurned(state, providerName, keyIdx, String(e.statusCode || 'auth'));
            await saveStateAtomic(state);
            break; // next key
          }
          if (kind === 'server_5xx') {
            consecutive5xx++;
            if (consecutive5xx >= 3) {
              markBurned(state, providerName, keyIdx, '5xx');
              await saveStateAtomic(state);
              break; // next key
            }
            if (attempt < 2) { await sleep(backoff(attempt)); continue; }
            break;
          }
          // Unknown kind — treat as caller error to avoid masking bugs.
          throw e;
        }
      }

      if (success) {
        state.last_ok_provider = providerName;
        state[providerName].current = keyIdx;
        await saveStateAtomic(state);
        await recordUsage({
          op: operation,
          provider: providerName,
          key_index: keyIdx,
          credits: success.usage && success.usage.credits,
          cached: false,
          latency_ms: success.latency_ms,
        });
        if (cKey && CACHEABLE.has(operation)) {
          await cacheSet(cKey, success);
        }
        return success;
      }

      // No success on this key; record summary and loop to next key.
      errors.push(`${providerName}#${keyIdx}: ${consecutive5xx ? '5xx' : consecutive429 ? '429' : consecutiveNetwork ? 'network' : 'auth'}`);
    }

    if (pinned) break;
  }

  throw new DispatchError(
    'AllProvidersExhausted',
    `operation '${operation}' failed on every provider/key${errors.length ? ': ' + errors.join('; ') : ''}`,
    { errors },
  );
}
