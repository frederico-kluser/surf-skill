// Interactive onboarding wizard. Requires a TTY. Non-TTY callers should use
// `surf-research-skill keys add` directly.
//
// Multi-key: prompts for N keys per provider (Enter to finish that provider).
// 3 providers: Tavily, Parallel, Brave.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadState, saveStateAtomic, KEYS_FILE } from './state.mjs';
import { validateKey, formatValidation } from '../validators/index.mjs';

const BANNER = `
┌─ surf-research-skill setup ──────────────────────────────────────
│ Configure API keys. You can add multiple keys per provider
│ (Enter empty to finish a provider; Enter twice in a row to
│ skip it entirely).
│
│ Tavily:    https://app.tavily.com                       (1,000 free credits/mo)
│ Parallel:  https://platform.parallel.ai
│ Brave:     https://api-dashboard.search.brave.com       ($5/mo credit, metered)
│
│ Keys live in ${KEYS_FILE} (chmod 600).
└──────────────────────────────────────────────────────────
`;

const CHEAT_SHEET_TPL = (counts) => `
✓ Saved. Now have ${counts.tav} Tavily key${counts.tav === 1 ? '' : 's'}, ${counts.par} Parallel key${counts.par === 1 ? '' : 's'}, ${counts.brv} Brave key${counts.brv === 1 ? '' : 's'}.

Try one of:
  surf-research-skill search "your query"
  surf-research-skill search "q1" "q2" "q3"                # batch (N queries)
  surf-research-skill search "x" --provider brave --mode fast
  surf-research-skill extract https://example.com
  surf-research-skill keys list

Add another key later with:
  surf-research-skill keys add --provider <tavily|parallel|brave> <key>

🛠  IMPORTANT — in each project where you'll use surf-research-skill, run:
      surf-research-skill project-config
   This raises the per-project bash timeout for the harness in that repo.

⚠  GitHub Copilot CLI users: this step is REQUIRED. Copilot's default bash
   timeout is 30s and surf-research-skill needs more (most commands run 3–60s).

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
  surf-research-skill keys add --provider tavily <key>
  surf-research-skill keys add --provider parallel <key>
  surf-research-skill keys add --provider brave <key>`);
    err.code = 'NO_TTY';
    throw err;
  }

  stdout.write(BANNER);

  const state = await loadState();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let newTav = [];
  let newPar = [];
  let newBrv = [];
  try {
    newTav = await promptKeys(rl, 'Tavily', state.tavily.keys);
    stdout.write('\n');
    newPar = await promptKeys(rl, 'Parallel', state.parallel.keys);
    stdout.write('\n');
    newBrv = await promptKeys(rl, 'Brave', state.brave.keys);
  } finally {
    rl.close();
  }

  if (!newTav.length && !newPar.length && !newBrv.length) {
    stdout.write('\nNo new keys provided. Rerun with: surf-research-skill setup\n');
    return { addedTavily: 0, addedParallel: 0, addedBrave: 0 };
  }

  // Live-validate every freshly collected key before persisting. Invalid
  // keys are dropped from the batch with a clear message. The user
  // doesn't waste hours wondering why fallback isn't kicking in.
  stdout.write('\n— Validating new keys against each provider (1 credit each) —\n');
  const keptTav = [];
  for (const k of newTav) {
    stdout.write(`  tavily ${k.slice(0, 5)}…${k.slice(-4)} → `);
    const r = await validateKey('tavily', k);
    stdout.write(formatValidation(r) + '\n');
    if (r.valid) keptTav.push(k);
  }
  const keptPar = [];
  for (const k of newPar) {
    stdout.write(`  parallel ${k.slice(0, 5)}…${k.slice(-4)} → `);
    const r = await validateKey('parallel', k);
    stdout.write(formatValidation(r) + '\n');
    if (r.valid) keptPar.push(k);
  }
  const keptBrv = [];
  for (const k of newBrv) {
    stdout.write(`  brave ${k.slice(0, 5)}…${k.slice(-4)} → `);
    const r = await validateKey('brave', k);
    stdout.write(formatValidation(r) + '\n');
    if (r.valid) keptBrv.push(k);
  }
  const dropped = (newTav.length - keptTav.length) + (newPar.length - keptPar.length) + (newBrv.length - keptBrv.length);
  if (dropped) {
    stdout.write(`\n⚠ ${dropped} key${dropped === 1 ? '' : 's'} failed validation and were NOT saved.\n`);
  }
  if (!keptTav.length && !keptPar.length && !keptBrv.length) {
    stdout.write('\nNo valid keys to save. Re-run `surf-research-skill setup` with working keys.\n');
    return { addedTavily: 0, addedParallel: 0, addedBrave: 0, dropped };
  }

  for (const k of keptTav) state.tavily.keys.push(k);
  for (const k of keptPar) state.parallel.keys.push(k);
  for (const k of keptBrv) state.brave.keys.push(k);
  if (state.tavily.keys.length && state.tavily.current >= state.tavily.keys.length) state.tavily.current = 0;
  if (state.parallel.keys.length && state.parallel.current >= state.parallel.keys.length) state.parallel.current = 0;
  if (state.brave.keys.length && state.brave.current >= state.brave.keys.length) state.brave.current = 0;

  await saveStateAtomic(state);

  stdout.write(CHEAT_SHEET_TPL({
    tav: state.tavily.keys.length,
    par: state.parallel.keys.length,
    brv: state.brave.keys.length,
  }));
  return {
    addedTavily: keptTav.length,
    addedParallel: keptPar.length,
    addedBrave: keptBrv.length,
    dropped,
  };
}
