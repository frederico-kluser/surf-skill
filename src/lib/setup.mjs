// Interactive onboarding wizard. Requires a TTY. Non-TTY callers should use
// `surf-skill keys add` directly.
//
// Multi-key: prompts for N keys per provider (Enter to finish that provider).

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadState, saveStateAtomic, KEYS_FILE } from './state.mjs';

const BANNER = `
┌─ surf-skill setup ──────────────────────────────────────
│ Configure API keys. You can add multiple keys per provider
│ (Enter empty to finish a provider; Enter twice in a row to
│ skip it entirely).
│
│ Tavily:    https://app.tavily.com    (1,000 free credits/mo)
│ Parallel:  https://platform.parallel.ai
│
│ Keys live in ${KEYS_FILE} (chmod 600).
└──────────────────────────────────────────────────────────
`;

const CHEAT_SHEET_TPL = (counts) => `
✓ Saved ${counts.tav} Tavily key${counts.tav === 1 ? '' : 's'}, ${counts.par} Parallel key${counts.par === 1 ? '' : 's'}.

Try one of:
  surf-skill search "your query"
  surf-skill search "q1" "q2" "q3"      # batch (N queries)
  surf-skill extract https://example.com
  surf-skill keys list

Add another key later with:
  surf-skill keys add --provider <tavily|parallel> <key>

🛠  IMPORTANT — in each project where you'll use surf-skill, run:
      surf-skill project-config
   This raises the per-project bash timeout for the harness in that repo.

⚠  GitHub Copilot CLI users: this step is REQUIRED. Copilot's default bash
   timeout is 30s and surf-skill needs more (most commands run 3–60s).

Docs: SKILL.md  ·  Repo: https://github.com/frederico-kluser/surf-skill
`;

async function promptKeys(rl, provider, existing = []) {
  const collected = [];
  let i = 1;
  const seen = new Set(existing);
  while (true) {
    const promptText = i === 1
      ? `${provider} key #${i} (Enter to skip ${provider}): `
      : `${provider} key #${i} (Enter to finish, or paste another): `;
    let ans = '';
    try {
      ans = (await rl.question(promptText)).trim();
    } catch {
      break;
    }
    if (!ans) break;
    if (seen.has(ans)) {
      stdout.write(`  (already configured, skipping)\n`);
      continue;
    }
    collected.push(ans);
    seen.add(ans);
    i++;
  }
  return collected;
}

export async function runSetup() {
  if (!stdin.isTTY) {
    const err = new Error(`'setup' requires a TTY. Use:
  surf-skill keys add --provider tavily <key>
  surf-skill keys add --provider parallel <key>`);
    err.code = 'NO_TTY';
    throw err;
  }

  stdout.write(BANNER);

  const state = await loadState();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let newTav = [];
  let newPar = [];
  try {
    newTav = await promptKeys(rl, 'Tavily', state.tavily.keys);
    stdout.write('\n');
    newPar = await promptKeys(rl, 'Parallel', state.parallel.keys);
  } finally {
    rl.close();
  }

  if (!newTav.length && !newPar.length) {
    stdout.write('\nNo new keys provided. Rerun with: surf-skill setup\n');
    return { addedTavily: 0, addedParallel: 0 };
  }

  for (const k of newTav) state.tavily.keys.push(k);
  for (const k of newPar) state.parallel.keys.push(k);
  if (state.tavily.keys.length && state.tavily.current >= state.tavily.keys.length) state.tavily.current = 0;
  if (state.parallel.keys.length && state.parallel.current >= state.parallel.keys.length) state.parallel.current = 0;

  await saveStateAtomic(state);

  stdout.write(CHEAT_SHEET_TPL({
    tav: state.tavily.keys.length,
    par: state.parallel.keys.length,
  }));
  return { addedTavily: newTav.length, addedParallel: newPar.length };
}
