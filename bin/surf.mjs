#!/usr/bin/env node
// `surf` — bundle wrapper for surf-search-skill + surf-plan-skill.
//
// Running `surf` with no args launches an interactive setup that:
//   1. Verifies both skills are installed (symlinks present)
//   2. Lists currently-configured keys per provider
//   3. Offers an interactive menu: add / list / remove / doctor / quit
//   4. EVERY key added is validated LIVE against the provider's API
//      before being saved (1-credit cost, ~1-3s per validation)
//
// This is the friendliest entry point. `surf-search-skill` and `surf-plan-skill`
// remain available for power users and scripts.

import readline from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadState, saveStateAtomic, KEYS_FILE, PROVIDERS } from '../src/lib/state.mjs';
import { validateKey, formatValidation } from '../src/validators/index.mjs';
import { HARNESS_DIRS } from '../src/lib/harness-install.mjs';

const VERSION = '4.0.0';

const HELP = `surf — multi-skill setup & validation

Bundles surf-search-skill (multi-provider web search) and surf-plan-skill
(research-driven execution planning) into one command.

Commands:
  (no args)              Interactive setup wizard (add keys with live validation)
  add                    Add a key (you'll be asked for provider + key)
  list                   List configured keys (masked) + last-known state
  validate [provider]    Re-validate all keys (or just one provider's)
  remove <provider> <i>  Remove key #i from provider
  doctor                 Diagnostics: skills installed? keys valid? harness symlinks?
  --help, -h             Show this help
  --version, -v          Show version

Power-user CLIs (also installed):
  surf-search-skill ...         The search engine (search/extract/crawl/map/research)
  surf-plan-skill ...    The planning skill (list/show/new/doctor)

Keys live in:        ${KEYS_FILE} (chmod 600)
Plans live in:       ~/.claude/plans/<slug>-<timestamp>.md (or ./plans/)
SKILL.md (search):   ~/.agents/skills/surf-search-skill/SKILL.md
SKILL.md (planning): ~/.agents/skills/surf-plan-skill/SKILL.md
`;

function out(s = '') {
  stdout.write(s + (s.endsWith('\n') ? '' : '\n'));
}
function err(s) {
  stderr.write(s + (s.endsWith('\n') ? '' : '\n'));
}
function mask(key) {
  if (!key || key.length < 8) return key;
  return key.slice(0, 5) + '…' + key.slice(-4);
}
function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function detectSkills() {
  const home = os.homedir();
  const skillsToCheck = ['surf-search-skill', 'surf-plan-skill'];
  const found = {};
  for (const skill of skillsToCheck) {
    found[skill] = { dirs: [] };
    for (const dir of HARNESS_DIRS) {
      const link = path.join(dir, skill);
      if (existsSync(link)) {
        try {
          const stat = await fs.lstat(link);
          found[skill].dirs.push({
            path: link,
            isSymlink: stat.isSymbolicLink(),
            isDir: stat.isDirectory(),
          });
        } catch {}
      }
    }
  }
  return found;
}

async function cmdList() {
  const state = await loadState();
  out(`**Keys** (config: \`${KEYS_FILE}\`, chmod 600)`);
  out(`last_ok_provider: \`${state.last_ok_provider || 'none yet'}\``);
  out('');
  for (const p of PROVIDERS) {
    const ps = state[p];
    out(`## ${p} (${ps.keys.length} key${ps.keys.length === 1 ? '' : 's'})`);
    if (!ps.keys.length) {
      out(`  _no keys — add with \`surf add\`_`);
      continue;
    }
    for (let i = 0; i < ps.keys.length; i++) {
      const isCur = i === ps.current ? ' (current)' : '';
      const burned = ps.burned.find(b => b.index === i);
      const burn = burned ? ` BURNED:${burned.reason} at ${burned.at.slice(0, 16)}` : '';
      out(`  [${i}] ${mask(ps.keys[i])}${isCur}${burn}`);
    }
  }
}

async function cmdValidate(providerFilter) {
  const state = await loadState();
  let any = false;
  for (const p of PROVIDERS) {
    if (providerFilter && p !== providerFilter) continue;
    const ps = state[p];
    if (!ps.keys.length) continue;
    any = true;
    out(`\n## ${p}`);
    for (let i = 0; i < ps.keys.length; i++) {
      stdout.write(`  [${i}] ${mask(ps.keys[i])} → `);
      const r = await validateKey(p, ps.keys[i]);
      out(formatValidation(r));
    }
  }
  if (!any) out(providerFilter ? `No keys for ${providerFilter}.` : 'No keys configured. Add one with `surf add`.');
}

async function cmdRemove(args) {
  const [provider, indexStr] = args;
  if (!provider || indexStr == null) {
    err('Usage: surf remove <provider> <index>');
    process.exit(1);
  }
  if (!PROVIDERS.includes(provider)) {
    err(`Unknown provider: ${provider}. Use: ${PROVIDERS.join('|')}`);
    process.exit(1);
  }
  const idx = Number(indexStr);
  const state = await loadState();
  const ps = state[provider];
  if (!Number.isInteger(idx) || idx < 0 || idx >= ps.keys.length) {
    err(`Invalid index ${indexStr}; ${provider} has ${ps.keys.length} key${ps.keys.length === 1 ? '' : 's'} (0-${ps.keys.length - 1}).`);
    process.exit(1);
  }
  const removed = ps.keys.splice(idx, 1)[0];
  ps.burned = ps.burned.filter(b => b.index !== idx).map(b => ({ ...b, index: b.index > idx ? b.index - 1 : b.index }));
  if (ps.current >= ps.keys.length) ps.current = 0;
  await saveStateAtomic(state);
  out(`✓ removed ${provider} key #${idx} (${mask(removed)})`);
}

async function cmdAdd(rl) {
  rl = rl || readline.createInterface({ input: stdin, output: stdout });
  let closeRl = !arguments.length;
  try {
    out('');
    let provider = '';
    while (!PROVIDERS.includes(provider)) {
      provider = (await rl.question(`Provider [${PROVIDERS.join('/')}]: `)).trim().toLowerCase();
      if (!PROVIDERS.includes(provider)) out(`  (unknown: ${provider}. Try: ${PROVIDERS.join(', ')})`);
    }
    const key = (await rl.question(`${provider} key: `)).trim();
    if (!key) { out('(empty — cancelled)'); return; }

    const state = await loadState();
    const ps = state[provider];
    if (ps.keys.includes(key)) {
      out(`  ℹ already configured at index ${ps.keys.indexOf(key)} — skipping`);
      return;
    }

    out(`  validating against ${provider} API (1 credit, ~2s)…`);
    const r = await validateKey(provider, key);
    out(`  ${formatValidation(r)}`);
    if (!r.valid) {
      out('  → key NOT saved. Try `surf add` again with a different key.');
      process.exitCode = 1;
      return;
    }

    ps.keys.push(key);
    if (ps.keys.length === 1) ps.current = 0;
    await saveStateAtomic(state);
    out(`✓ saved as ${provider} key #${ps.keys.length - 1}. Total ${provider}: ${ps.keys.length}.`);
  } finally {
    if (closeRl) rl.close();
  }
}

async function cmdDoctor() {
  out('## Skills');
  const found = await detectSkills();
  for (const [skill, info] of Object.entries(found)) {
    if (!info.dirs.length) {
      out(`  ✗ ${skill}: NOT found in any harness skill dir`);
      out(`    → reinstall: npm i -g surf-skill@latest`);
      process.exitCode = 1;
    } else {
      const sample = info.dirs[0];
      out(`  ✓ ${skill}: ${info.dirs.length} harness${info.dirs.length === 1 ? '' : 'es'}`);
      for (const d of info.dirs) out(`      ${d.path}${d.isSymlink ? ' (symlink)' : ''}`);
    }
  }

  out('\n## Keys');
  const state = await loadState();
  const totals = PROVIDERS.map(p => ({ p, n: state[p].keys.length, burned: state[p].burned.length }));
  for (const t of totals) {
    const status = t.n === 0 ? '⚠ no keys' : t.burned ? `${t.n} key(s), ${t.burned} burned` : `${t.n} key(s) ✓`;
    out(`  ${t.p.padEnd(10)} ${status}`);
  }
  if (totals.every(t => t.n === 0)) {
    out('\n  → Run `surf` to add your first key.');
    process.exitCode = 2;
  }

  out('\n## Plans');
  const plansDir = path.join(os.homedir(), '.claude', 'plans');
  if (existsSync(plansDir)) {
    const files = (await fs.readdir(plansDir)).filter(f => f.endsWith('.md'));
    out(`  ${files.length} plan file${files.length === 1 ? '' : 's'} in ${plansDir}`);
  } else {
    out(`  ${plansDir} not created yet`);
  }
}

async function interactiveMenu() {
  out('');
  out('┌─ surf — multi-skill setup & validation ─────────────────');
  out(`│ Skills detected:`);
  const found = await detectSkills();
  for (const [skill, info] of Object.entries(found)) {
    const status = info.dirs.length ? `✓ ${info.dirs.length} harness${info.dirs.length === 1 ? '' : 'es'}` : '✗ NOT INSTALLED';
    out(`│   ${skill.padEnd(20)} ${status}`);
  }

  const state = await loadState();
  const counts = PROVIDERS.map(p => `${p} ${state[p].keys.length}`).join(', ');
  out(`│ Keys: ${counts}`);
  out(`│ Config: ${KEYS_FILE}`);
  out('└──────────────────────────────────────────────────────────');
  out('');

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      out('What do you want to do?');
      out('  [1] Add a key (with live validation)');
      out('  [2] List + revalidate all keys');
      out('  [3] Remove a key');
      out('  [4] Diagnostics (skills + symlinks + dirs)');
      out('  [q] Quit');
      const choice = (await rl.question('> ')).trim().toLowerCase();
      out('');
      if (choice === '1' || choice === 'add') {
        await cmdAdd(rl);
      } else if (choice === '2' || choice === 'list') {
        await cmdValidate();
      } else if (choice === '3' || choice === 'remove') {
        const provider = (await rl.question(`Provider [${PROVIDERS.join('/')}]: `)).trim();
        const idx = (await rl.question('Index: ')).trim();
        await cmdRemove([provider, idx]).catch(e => err(`✗ ${e.message}`));
      } else if (choice === '4' || choice === 'doctor') {
        await cmdDoctor();
      } else if (choice === 'q' || choice === 'quit' || choice === 'exit' || !choice) {
        out('bye 🌊');
        return;
      } else {
        out(`(unknown choice: ${choice})`);
      }
      out('');
    }
  } finally {
    rl.close();
  }
}

const [, , cmd, ...rest] = process.argv;

try {
  if (!cmd) {
    if (!stdin.isTTY) {
      err(`surf requires a TTY for interactive setup. Use a subcommand:
  surf add | list | validate | remove <provider> <i> | doctor`);
      process.exit(1);
    }
    await interactiveMenu();
  } else if (cmd === '--help' || cmd === '-h') {
    out(HELP);
  } else if (cmd === '--version' || cmd === '-v') {
    out(VERSION);
  } else if (cmd === 'add') {
    if (!stdin.isTTY) {
      err('`surf add` is interactive and requires a TTY. Use `surf-search-skill keys add --provider X <key>` for scripts.');
      process.exit(1);
    }
    await cmdAdd();
  } else if (cmd === 'list') {
    await cmdList();
  } else if (cmd === 'validate') {
    await cmdValidate(rest[0]);
  } else if (cmd === 'remove') {
    await cmdRemove(rest);
  } else if (cmd === 'doctor') {
    await cmdDoctor();
  } else {
    err(`Unknown command: ${cmd}. Try 'surf --help'.`);
    process.exit(1);
  }
} catch (e) {
  err(`❌ Error: ${e.message || String(e)}`);
  process.exit(1);
}
