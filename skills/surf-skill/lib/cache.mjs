// Response cache keyed by (provider, endpoint, body).

import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CACHE_DIR, ensureCacheDir } from './state.mjs';

export const TTL_MS = (Number(process.env.SURF_CACHE_TTL || process.env.TAVILY_CACHE_TTL) || 21600) * 1000;

export function cacheKey(provider, endpoint, body) {
  return createHash('sha256')
    .update(`${provider}:${endpoint}:${JSON.stringify(body || {})}`)
    .digest('hex')
    .slice(0, 24);
}

export async function cacheGet(key) {
  const f = join(CACHE_DIR, key + '.json');
  if (!existsSync(f)) return null;
  try {
    const raw = JSON.parse(await readFile(f, 'utf8'));
    if (Date.now() - raw.ts > TTL_MS) return null;
    return raw.data;
  } catch {
    return null;
  }
}

export async function cacheSet(key, data) {
  await ensureCacheDir();
  await writeFile(join(CACHE_DIR, key + '.json'), JSON.stringify({ ts: Date.now(), data }));
}

export async function cacheClear() {
  if (!existsSync(CACHE_DIR)) return 0;
  const files = await readdir(CACHE_DIR);
  let n = 0;
  for (const f of files) {
    if (f.endsWith('.json')) {
      await unlink(join(CACHE_DIR, f));
      n++;
    }
  }
  return n;
}
