// `surf-skill keys` subcommands: add, remove, list (status), reset, clear.

import { loadState, saveStateAtomic, clearBurned, PROVIDERS, KEYS_FILE } from './state.mjs';
import { maskKey } from './flags.mjs';

function nextResetIso(burnedAt) {
  const d = new Date(burnedAt);
  if (Number.isNaN(d.getTime())) return '—';
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
  return next.toISOString();
}

function requireProvider(flags, allowAll = false) {
  const p = flags.provider;
  if (!p) {
    if (allowAll && flags.all) return null;
    throw new Error(`--provider <${PROVIDERS.join('|')}> is required`);
  }
  if (!PROVIDERS.includes(p)) {
    throw new Error(`unknown provider '${p}' (valid: ${PROVIDERS.join(', ')})`);
  }
  return p;
}

export async function keysAdd(pos, flags) {
  const provider = requireProvider(flags);
  const key = pos[0];
  if (!key) throw new Error('Usage: surf-skill keys add --provider <name> <key>');
  const state = await loadState();
  if (state[provider].keys.includes(key)) {
    return { provider, added: false, reason: 'already exists', state };
  }
  state[provider].keys.push(key);
  if (state[provider].keys.length === 1) state[provider].current = 0;
  await saveStateAtomic(state);
  return { provider, added: true, index: state[provider].keys.length - 1, state };
}

export async function keysRemove(pos, flags) {
  const provider = requireProvider(flags);
  const target = pos[0];
  if (target == null) throw new Error('Usage: surf-skill keys remove --provider <name> <index|key>');
  const state = await loadState();
  const keys = state[provider].keys;
  let idx = -1;
  if (/^\d+$/.test(String(target))) {
    idx = Number(target);
  } else {
    idx = keys.indexOf(target);
  }
  if (idx < 0 || idx >= keys.length) throw new Error(`no key at '${target}' for provider '${provider}'`);
  keys.splice(idx, 1);
  // adjust current and burned indices
  if (state[provider].current >= keys.length) state[provider].current = 0;
  state[provider].burned = state[provider].burned
    .filter(b => b.index !== idx)
    .map(b => (b.index > idx ? { ...b, index: b.index - 1 } : b));
  await saveStateAtomic(state);
  return { provider, removed: true, index: idx, state };
}

export async function keysList(_pos, flags) {
  const state = await loadState();
  if (flags.json) return { json: true, state };
  const lines = [];
  lines.push(`**Surf keys** (config: \`${KEYS_FILE}\`)`);
  lines.push(`last_ok_provider: \`${state.last_ok_provider || 'none'}\`\n`);
  for (const p of PROVIDERS) {
    const pp = state[p];
    const burnedIdx = new Set(pp.burned.map(b => b.index));
    lines.push(`## ${p} (${pp.keys.length} key${pp.keys.length === 1 ? '' : 's'})`);
    if (!pp.keys.length) {
      lines.push(`_no keys — add with \`surf-skill keys add --provider ${p} <key>\`_\n`);
      continue;
    }
    pp.keys.forEach((k, i) => {
      const flags = [];
      if (i === pp.current) flags.push('current');
      if (burnedIdx.has(i)) flags.push('burned');
      lines.push(`- [${i}] ${maskKey(k)}${flags.length ? '  *(' + flags.join(', ') + ')*' : ''}`);
    });
    if (pp.burned.length) {
      lines.push('');
      lines.push(`**Burned:**`);
      for (const b of pp.burned) {
        lines.push(`- index ${b.index} — reason: ${b.reason}, at ${b.at}, auto-reset on ${nextResetIso(b.at)}`);
      }
    }
    lines.push('');
  }
  return { text: lines.join('\n') };
}

export async function keysReset(_pos, flags) {
  const state = await loadState();
  const provider = flags.provider ? requireProvider(flags) : null;
  clearBurned(state, provider);
  await saveStateAtomic(state);
  return { provider, reset: true, state };
}

export async function keysClear(_pos, flags) {
  if (!flags.yes) {
    const tty = process.stdin && process.stdin.isTTY;
    if (!tty) {
      const err = new Error('non-interactive: pass --yes to confirm destructive clear');
      err.code = 'NEEDS_YES';
      throw err;
    }
  }
  const state = await loadState();
  if (flags.all) {
    for (const p of PROVIDERS) state[p] = { keys: [], current: 0, burned: [] };
    state.last_ok_provider = null;
  } else {
    const provider = requireProvider(flags);
    state[provider] = { keys: [], current: 0, burned: [] };
    if (state.last_ok_provider === provider) state.last_ok_provider = null;
  }
  await saveStateAtomic(state);
  return { cleared: true, state };
}

export async function runKeysSubcommand(sub, pos, flags) {
  switch (sub) {
    case 'add': return keysAdd(pos, flags);
    case 'remove':
    case 'rm':
    case 'delete': return keysRemove(pos, flags);
    case 'list':
    case 'ls':
    case 'status': return keysList(pos, flags);
    case 'reset': return keysReset(pos, flags);
    case 'clear': return keysClear(pos, flags);
    default:
      throw new Error(`unknown 'surf-skill keys' subcommand: '${sub}'. Valid: add, remove, list, reset, clear`);
  }
}
