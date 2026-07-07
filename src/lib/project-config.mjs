// `surf-research-skill project-config` — writes per-project harness config to raise
// the bash timeout that the harness uses. Detects which harness is in use
// from the presence of `.github/`, `.claude/`, `.pi/` in the cwd. With
// --harness, forces a specific target.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export const HARNESSES = ['copilot', 'claude', 'pi'];

const PATCHES = {
  copilot: {
    file: '.github/copilot-hooks.json',
    patch: { timeoutSec: 300 },
    why: 'GH Copilot CLI default bash timeout is 30s — surf-research-skill needs more.',
  },
  claude: {
    // .claude/settings.local.json is gitignored by Anthropic convention.
    file: '.claude/settings.local.json',
    patch: {
      env: {
        BASH_DEFAULT_TIMEOUT_MS: '300000',
        BASH_MAX_TIMEOUT_MS: '600000',
      },
    },
    why: 'Claude Code default bash timeout is 120s; raising to 300s.',
  },
  pi: {
    file: '.pi/settings.json',
    patch: {
      env: {
        PI_BASH_DEFAULT_TIMEOUT_SECONDS: '300',
        PI_BASH_MAX_TIMEOUT_SECONDS: '600',
      },
    },
    why: 'Pi core applies NO bash timeout — long surf calls run unbounded by ' +
      'default. These vars only bind the optional `pi-bash-timeout` extension, ' +
      'raising its cap to 300s/600s if installed. For calls you KNOW are long, ' +
      'pass --no-budget (or set SURF_NO_TIMEOUT=1).',
  },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, source) {
  if (!isPlainObject(target)) return source;
  if (!isPlainObject(source)) return source;
  for (const k of Object.keys(source)) {
    if (isPlainObject(source[k])) {
      target[k] = deepMerge(isPlainObject(target[k]) ? target[k] : {}, source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

async function mergeJsonFile(absPath, patch) {
  await mkdir(dirname(absPath), { recursive: true });
  let current = {};
  if (existsSync(absPath)) {
    try { current = JSON.parse(await readFile(absPath, 'utf8')); } catch { current = {}; }
  }
  const merged = deepMerge(current, patch);
  await writeFile(absPath, JSON.stringify(merged, null, 2) + '\n');
  return { wrote: absPath, patch, merged };
}

export function detectHarnesses(cwd) {
  const found = [];
  if (existsSync(join(cwd, '.github'))) found.push('copilot');
  if (existsSync(join(cwd, '.claude'))) found.push('claude');
  if (existsSync(join(cwd, '.pi'))) found.push('pi');
  return found;
}

async function promptHarness() {
  if (!stdin.isTTY) {
    const err = new Error(
      "project-config could not detect any harness directory and stdin is not a TTY. " +
      "Pass --harness <copilot|claude|pi|all>."
    );
    err.code = 'PROJECT_CONFIG_NO_TTY';
    throw err;
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const a = (await rl.question(
      'No harness directory detected here. Which harness? [copilot/claude/pi/all]: '
    )).trim().toLowerCase();
    if (a === 'all') return [...HARNESSES];
    if (HARNESSES.includes(a)) return [a];
    throw Object.assign(new Error(`unknown harness '${a}'`), { code: 'PROJECT_CONFIG_BAD_HARNESS' });
  } finally {
    rl.close();
  }
}

export async function runProjectConfig(_pos, flags = {}, cwd = process.cwd()) {
  let targets;
  if (flags.harness) {
    if (flags.harness === 'all') {
      targets = [...HARNESSES];
    } else if (HARNESSES.includes(flags.harness)) {
      targets = [flags.harness];
    } else {
      throw Object.assign(
        new Error(`unknown --harness '${flags.harness}'; valid: ${HARNESSES.join(', ')}, all`),
        { code: 'PROJECT_CONFIG_BAD_HARNESS' }
      );
    }
  } else {
    const detected = detectHarnesses(cwd);
    targets = detected.length ? detected : await promptHarness();
  }

  const results = [];
  for (const t of targets) {
    const spec = PATCHES[t];
    const abs = resolve(cwd, spec.file);
    const r = await mergeJsonFile(abs, spec.patch);
    results.push({ harness: t, file: r.wrote, why: spec.why });
  }

  return { cwd, targets, results };
}

export function formatProjectConfigResult(result, { json = false } = {}) {
  if (json) return JSON.stringify(result, null, 2);
  const lines = [`✓ surf-research-skill project-config in ${result.cwd}`];
  for (const r of result.results) {
    lines.push(`  • ${r.harness}: wrote ${r.file}`);
    lines.push(`      ${r.why}`);
  }
  lines.push('');
  if (result.targets.includes('copilot')) {
    lines.push('ℹ Commit .github/copilot-hooks.json so teammates inherit the timeout.');
  }
  if (result.targets.includes('claude')) {
    lines.push('ℹ .claude/settings.local.json is .gitignored by convention (per-user).');
  }
  if (result.targets.includes('pi')) {
    lines.push('ℹ Pi core has no bash timeout; .pi/settings.json only matters with the `pi-bash-timeout` extension. For long calls, run `surf-research-skill ... --no-budget`.');
  }
  return lines.join('\n');
}
