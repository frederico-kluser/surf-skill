#!/usr/bin/env node
// Runs after `npm install`. Idempotent. Must never fail npm install.
// - Detects global vs local install.
// - Global: symlinks/copies package into the 4 supported harness skill dirs,
//   creates ~/.config/surf/keys.json skeleton, cleans legacy 'tavily'/'surf'/'tvly'
//   symlinks from prior versions.
// - Local: just prints "installed as library" and exits.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installSkill,
  cleanupLegacy,
  ensureKeysSkeleton,
} from '../lib/harness-install.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..', '..');

const isGlobal = process.env.npm_config_global === 'true';
// Some CI environments don't set npm_config_global; also treat the case where
// __dirname is under a global node_modules path as "global enough".
const looksGlobal = /node_modules\/surf-skill\/src\/install$/.test(__dirname) ||
                    /node_modules\\surf-skill\\src\\install$/.test(__dirname);

async function main() {
  if (!isGlobal && !looksGlobal) {
    // Local install: don't touch user system. Library mode.
    process.stdout.write('surf-skill installed as a library (npm i surf-skill).\n');
    process.stdout.write('  → For the global CLI: npm i -g surf-skill\n');
    process.stdout.write('  → To import: import { search } from "surf-skill"\n');
    return;
  }

  // Cleanup legacy symlinks from earlier versions BEFORE creating new ones.
  const legacy = await cleanupLegacy();
  for (const r of legacy) {
    process.stdout.write(`✓ removed legacy ${r.removed}\n`);
  }

  // Install symlinks into each harness skill dir.
  const installed = await installSkill(pkgRoot);
  for (const r of installed) {
    if (r.action === 'error') {
      process.stdout.write(`⚠ ${r.dir}: ${r.error}\n`);
    } else {
      const verb = {
        symlinked: '✓ symlinked',
        copied: '✓ copied (no symlink permission)',
        'kept-symlink': '✓ already linked',
        'preserved-existing': 'ℹ preserved your existing copy at',
      }[r.action] || r.action;
      process.stdout.write(`${verb} ${r.dir}\n`);
    }
  }

  // Create state dir + skeleton keys.json.
  const skel = await ensureKeysSkeleton();
  if (skel.created) process.stdout.write(`✓ created ${skel.created} (chmod 600)\n`);

  process.stdout.write('\n');
  process.stdout.write('✓ surf-skill 2.0.0 installed globally\n');
  process.stdout.write('  → Run `surf-skill setup` to add Tavily/Parallel keys\n');
  process.stdout.write('    (or just run any command — wizard auto-launches in TTY)\n');
  process.stdout.write('  → `surf-skill --help` for the full command list\n');
}

main().catch(e => {
  // NEVER fail npm install. Print warning + exit 0.
  process.stderr.write(`surf-skill postinstall warning: ${e.message}\n`);
  process.stderr.write('  (skill is installed; harness symlinks may need manual setup)\n');
  process.exit(0);
});
