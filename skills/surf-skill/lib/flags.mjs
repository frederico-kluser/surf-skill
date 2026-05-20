// Generic helpers: flag parsing, string ops, key masking.

export function parseFlags(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) flags[k] = true;
      else { flags[k] = next; i++; }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

export function ceilDiv(a, b) {
  return Math.ceil(a / b);
}

export function splitList(s) {
  return typeof s === 'string' ? s.split(',').map(x => x.trim()).filter(Boolean) : undefined;
}

export function trunc(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function flat(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return flat(v.message) || flat(v.error) || flat(v.detail) || JSON.stringify(v);
}

export function maskKey(key) {
  if (!key || typeof key !== 'string') return '<empty>';
  if (key.length <= 9) return key.slice(0, 2) + '…' + key.slice(-2);
  return key.slice(0, 5) + '…' + key.slice(-4);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function nowIso() {
  return new Date().toISOString();
}

export function compactObject(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
