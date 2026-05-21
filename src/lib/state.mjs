// State management: ~/.config/surf/keys.json with atomic writes, lockfile,
// monthly auto-reset of burned keys, and one-shot migration of the legacy
// ~/.cache/tavily-skill/ directory.

import { mkdir, readFile, writeFile, rename, rm, stat, chmod, readdir, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { sleep } from './flags.mjs';

export const CONFIG_DIR = join(homedir(), '.config', 'surf');
export const KEYS_FILE = join(CONFIG_DIR, 'keys.json');
export const LOCK_FILE = join(CONFIG_DIR, '.keys.lock');
export const CACHE_DIR = join(homedir(), '.cache', 'surf');
export const LEGACY_CACHE_DIR = join(homedir(), '.cache', 'tavily-skill');

export const PROVIDERS = ['tavily', 'parallel', 'brave'];
export const SCHEMA_VERSION = 1;

const BURNED_CAP = 50;

function blankProvider() {
  return { keys: [], current: 0, burned: [] };
}

function blankState() {
  const s = { schema_version: SCHEMA_VERSION, last_ok_provider: null };
  for (const p of PROVIDERS) s[p] = blankProvider();
  return s;
}

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

async function acquireLock(timeoutMs = 2000) {
  await ensureConfigDir();
  const start = Date.now();
  let backoff = 20;
  while (true) {
    try {
      const fh = await open(LOCK_FILE, 'wx');
      await fh.close();
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - start > timeoutMs) {
        try { await rm(LOCK_FILE, { force: true }); } catch {}
        const fh = await open(LOCK_FILE, 'wx').catch(() => null);
        if (fh) { await fh.close(); return; }
        throw new Error('Could not acquire keys.json lock');
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 200);
    }
  }
}

async function releaseLock() {
  try { await rm(LOCK_FILE, { force: true }); } catch {}
}

function normalizeProvider(p) {
  const obj = p && typeof p === 'object' ? p : {};
  return {
    keys: Array.isArray(obj.keys) ? obj.keys.filter(k => typeof k === 'string' && k) : [],
    current: Number.isInteger(obj.current) ? obj.current : 0,
    burned: Array.isArray(obj.burned) ? obj.burned.filter(b => b && typeof b === 'object' && Number.isInteger(b.index)) : [],
  };
}

function applyMonthlyReset(state) {
  const now = new Date();
  const nowY = now.getUTCFullYear();
  const nowM = now.getUTCMonth();
  for (const p of PROVIDERS) {
    const before = state[p].burned.length;
    state[p].burned = state[p].burned.filter(b => {
      const at = new Date(b.at);
      if (Number.isNaN(at.getTime())) return false;
      return !(nowY > at.getUTCFullYear() || (nowY === at.getUTCFullYear() && nowM > at.getUTCMonth()));
    });
    if (state[p].burned.length !== before) {
      // current may now point to a slot that became usable again — leave as-is;
      // nextUsableKeyIndex will surface the lowest usable.
    }
  }
  return state;
}

export async function migrateLegacy() {
  try {
    if (!existsSync(LEGACY_CACHE_DIR)) return;
    if (existsSync(CACHE_DIR)) {
      // Both exist — move unique files from legacy into a sidecar dir.
      const sidecar = join(CACHE_DIR, 'legacy-tavily');
      await mkdir(sidecar, { recursive: true });
      const entries = await readdir(LEGACY_CACHE_DIR);
      for (const f of entries) {
        const src = join(LEGACY_CACHE_DIR, f);
        const dst = join(sidecar, f);
        if (!existsSync(dst)) {
          try { await rename(src, dst); } catch {}
        }
      }
      try { await rm(LEGACY_CACHE_DIR, { recursive: true, force: true }); } catch {}
    } else {
      await rename(LEGACY_CACHE_DIR, CACHE_DIR);
    }
  } catch {
    // Migration is best-effort; never block startup.
  }
}

// Normalize a parsed keys.json to the current schema. Crucially, this
// auto-adds any provider section that's missing from older keys.json files
// (e.g. v2.0.x users upgrading to v2.1.x get a fresh `brave` section without
// any manual migration step).
function normalizeFullState(parsed) {
  const out = {
    schema_version: (parsed && parsed.schema_version) || SCHEMA_VERSION,
    last_ok_provider: parsed && PROVIDERS.includes(parsed.last_ok_provider)
      ? parsed.last_ok_provider
      : null,
  };
  for (const p of PROVIDERS) {
    out[p] = normalizeProvider(parsed && parsed[p]);
  }
  return out;
}

export async function loadState({ skipMonthlyReset = false } = {}) {
  await ensureConfigDir();
  let raw = blankState();
  if (existsSync(KEYS_FILE)) {
    try {
      const txt = await readFile(KEYS_FILE, 'utf8');
      const parsed = JSON.parse(txt);
      raw = normalizeFullState(parsed);
    } catch {
      raw = blankState();
    }
  } else {
    await saveStateAtomic(raw);
  }
  if (!skipMonthlyReset) applyMonthlyReset(raw);
  return raw;
}

export async function saveStateAtomic(state) {
  await ensureConfigDir();
  await acquireLock();
  try {
    const safe = normalizeFullState(state);
    const tmp = KEYS_FILE + '.tmp';
    const payload = JSON.stringify(safe, null, 2);
    await writeFile(tmp, payload, { mode: 0o600 });
    await rename(tmp, KEYS_FILE);
    try { await chmod(KEYS_FILE, 0o600); } catch {}
  } finally {
    await releaseLock();
  }
}

export function providerHasUsableKey(state, provider) {
  const p = state[provider];
  if (!p || !p.keys.length) return false;
  const burnedIdx = new Set(p.burned.map(b => b.index));
  return p.keys.some((_, i) => !burnedIdx.has(i));
}

export function nextUsableKeyIndex(state, provider, skipIndex = -1) {
  const p = state[provider];
  if (!p || !p.keys.length) return -1;
  const burnedIdx = new Set(p.burned.map(b => b.index));
  const n = p.keys.length;
  const start = Number.isInteger(p.current) ? Math.max(0, Math.min(p.current, n - 1)) : 0;
  for (let off = 0; off < n; off++) {
    const i = (start + off) % n;
    if (i === skipIndex) continue;
    if (!burnedIdx.has(i)) return i;
  }
  return -1;
}

export function markBurned(state, provider, index, reason) {
  const p = state[provider];
  if (!p) return;
  if (p.burned.some(b => b.index === index)) return;
  p.burned.push({ index, at: new Date().toISOString(), reason: String(reason || 'unknown') });
  while (p.burned.length > BURNED_CAP) p.burned.shift();
}

export function clearBurned(state, provider) {
  if (provider) state[provider].burned = [];
  else for (const p of PROVIDERS) state[p].burned = [];
}

export async function ensureCacheDir() {
  await mkdir(CACHE_DIR, { recursive: true });
}
