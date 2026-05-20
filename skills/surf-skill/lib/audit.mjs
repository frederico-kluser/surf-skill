// Append-only audit log and usage ledger. Never logs API keys — only provider
// name and key index.

import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ensureCacheDir } from './state.mjs';

export const AUDIT_LOG = join(CACHE_DIR, 'audit.log');
export const USAGE_LOG = join(CACHE_DIR, 'usage.jsonl');

async function appendJsonl(path, entry) {
  await ensureCacheDir();
  await appendFile(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export async function audit(event) {
  await appendJsonl(AUDIT_LOG, event);
}

export async function recordUsage(event) {
  await appendJsonl(USAGE_LOG, event);
}

export async function readUsage() {
  if (!existsSync(USAGE_LOG)) return [];
  const raw = await readFile(USAGE_LOG, 'utf8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
