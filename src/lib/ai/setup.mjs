// `surf-research-skill ai-setup` — the one-question wizard that turns surf-ai on.
//
// surf-ai needs exactly one extra credential beyond the search keys: an
// OpenRouter API key, which pays for the DeepSeek calls that plan, analyze and
// synthesize. This asks for it, validates it for free (GET /api/v1/key burns
// no tokens), and stores it in the same chmod-600 keys.json as everything else.
//
// Accepts multiple keys — surf-ai rotates across them exactly like the search
// providers, so a rate-limited or drained key never stops a run.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadState, saveStateAtomic, KEYS_FILE } from '../state.mjs';
import { validateKey, formatValidation } from '../../validators/index.mjs';
import { PRIMARY_MODEL, resolveModels } from './openrouter.mjs';

const BANNER = `
┌─ surf-ai setup ──────────────────────────────────────────
│ surf-ai runs the whole research loop inside the CLI:
│   plan → parallel search → gap analysis → more search → answer
│
│ It needs ONE key: OpenRouter (pays for the DeepSeek calls).
│   Get one at: https://openrouter.ai/keys
│
│ Default model: ${PRIMARY_MODEL}
│ You can paste several keys — surf-ai rotates them automatically.
│ Validation is FREE (key introspection, no tokens burned).
│
│ Keys live in ${KEYS_FILE} (chmod 600).
└──────────────────────────────────────────────────────────
`;

const DONE = (n, total) => `
✓ Saved ${n} OpenRouter key${n === 1 ? '' : 's'} (${total} total).

surf-ai is live. Two modes, nothing else to choose:

  surf-search-normal  "your question" --task "..." --goal "..." --insights "..."
      One research round, fitted inside the agent's bash timeout. Never killed.

  surf-search-unlimit "your question" --task "..." --goal "..." --insights "..."
      As many rounds as the question needs. For harnesses with no bash timeout,
      or a Bash call you have already given a long timeout.

Model chain in use (first that answers wins):
${resolveModels().map(m => '  · ' + m).join('\n')}

Override with --ai-model <slug> or SURF_AI_MODEL=<slug>.
Add more keys later:  surf-research-skill keys add --provider openrouter <key>
`;

export async function runAiSetup(flags = {}) {
  // Non-interactive path: --key can be repeated via comma separation.
  const inline = typeof flags.key === 'string'
    ? flags.key.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  if (!inline.length && !stdin.isTTY) {
    const err = new Error(`'ai-setup' needs a TTY, or pass the key inline:
  surf-research-skill ai-setup --key sk-or-v1-...
  surf-research-skill keys add --provider openrouter sk-or-v1-...
Get a key at https://openrouter.ai/keys`);
    err.code = 'NO_TTY';
    throw err;
  }

  const state = await loadState();
  const existing = new Set(state.openrouter.keys);
  let collected = inline;

  if (!collected.length) {
    stdout.write(BANNER);
    if (existing.size) {
      stdout.write(`ℹ ${existing.size} OpenRouter key(s) already configured. Adding more is fine.\n\n`);
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const seen = new Set(existing);
    const out = [];
    try {
      let i = 1;
      while (true) {
        const prompt = i === 1
          ? 'OpenRouter key (Enter to cancel): '
          : `OpenRouter key #${i} (Enter to finish): `;
        let ans = '';
        try { ans = (await rl.question(prompt)).trim(); } catch { break; }
        if (!ans) break;
        if (seen.has(ans)) { stdout.write('  (already configured, skipping)\n'); continue; }
        seen.add(ans);
        out.push(ans);
        i++;
      }
    } finally {
      rl.close();
    }
    collected = out;
  }

  if (!collected.length) {
    stdout.write('\nNo key provided. surf-ai stays off; the plain `search` commands still work.\n');
    stdout.write('Re-run any time: surf-research-skill ai-setup\n');
    return { added: 0, total: state.openrouter.keys.length };
  }

  stdout.write('\n— Validating (free: key introspection, no tokens) —\n');
  const kept = [];
  for (const k of collected) {
    if (existing.has(k)) { stdout.write(`  ${mask(k)} → already configured, skipping\n`); continue; }
    stdout.write(`  ${mask(k)} → `);
    const r = await validateKey('openrouter', k);
    stdout.write(formatValidation(r) + '\n');
    if (r.valid) kept.push(k);
  }

  const dropped = collected.length - kept.length - collected.filter(k => existing.has(k)).length;
  if (dropped > 0) {
    stdout.write(`\n⚠ ${dropped} key${dropped === 1 ? '' : 's'} failed validation and ${dropped === 1 ? 'was' : 'were'} NOT saved.\n`);
  }
  if (!kept.length) {
    stdout.write('\nNothing saved. Get a working key at https://openrouter.ai/keys and re-run.\n');
    return { added: 0, total: state.openrouter.keys.length, dropped };
  }

  for (const k of kept) state.openrouter.keys.push(k);
  if (state.openrouter.current >= state.openrouter.keys.length) state.openrouter.current = 0;
  await saveStateAtomic(state);

  stdout.write(DONE(kept.length, state.openrouter.keys.length));
  return { added: kept.length, total: state.openrouter.keys.length, dropped };
}

function mask(key) {
  if (!key || key.length <= 9) return '<key>';
  return key.slice(0, 8) + '…' + key.slice(-4);
}
