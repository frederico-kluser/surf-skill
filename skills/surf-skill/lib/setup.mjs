// Interactive onboarding wizard. Requires a TTY. Non-TTY callers should use
// `surf-skill keys add` directly.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadState, saveStateAtomic, KEYS_FILE } from './state.mjs';

const BANNER = `
┌─ surf-skill setup ──────────────────────────────────────
│ Configure API keys. Press Enter to skip a provider.
│
│ Tavily:    https://app.tavily.com    (1,000 free credits/mo)
│ Parallel:  https://platform.parallel.ai
│
│ Keys live in ${KEYS_FILE} (chmod 600).
└──────────────────────────────────────────────────────────
`;

const CHEAT_SHEET = `
✓ Saved. Try one of:
  surf-skill search "your query"
  surf-skill extract https://example.com
  surf-skill keys list

Add another key later with:
  surf-skill keys add --provider <tavily|parallel> <key>

🛠  IMPORTANT — in each project where you'll use surf-skill, run:
      surf-skill project-config
   This raises the per-project bash timeout for the harness in that repo.

⚠  GitHub Copilot CLI users: this step is REQUIRED. Copilot's default bash
   timeout is 30s and surf-skill needs more (most commands run 3–60s).

Docs: ~/.agents/skills/surf-skill/SKILL.md
`;

export async function runSetup() {
  if (!stdin.isTTY) {
    const err = new Error(`'setup' requires a TTY. Use:
  surf-skill keys add --provider tavily <key>
  surf-skill keys add --provider parallel <key>`);
    err.code = 'NO_TTY';
    throw err;
  }

  stdout.write(BANNER);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let tav = '';
  let par = '';
  try {
    tav = (await rl.question('Tavily key (Enter to skip): ')).trim();
    par = (await rl.question('Parallel key (Enter to skip): ')).trim();
  } finally {
    rl.close();
  }

  if (!tav && !par) {
    stdout.write('\nNo keys provided. Rerun with: surf-skill setup\n');
    return { added: 0 };
  }

  const state = await loadState();
  let added = 0;
  if (tav) {
    if (!state.tavily.keys.includes(tav)) { state.tavily.keys.push(tav); added++; }
    if (state.tavily.keys.length === 1) state.tavily.current = 0;
  }
  if (par) {
    if (!state.parallel.keys.includes(par)) { state.parallel.keys.push(par); added++; }
    if (state.parallel.keys.length === 1) state.parallel.current = 0;
  }
  await saveStateAtomic(state);

  stdout.write(CHEAT_SHEET);
  return { added };
}
