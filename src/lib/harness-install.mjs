// Cross-OS skill registration helpers used by postinstall / preuninstall.
//
// Strategy:
//   - Symlink the package root into each harness's skill dir
//     (~/.claude/skills/surf-skill, ~/.agents/skills/surf-skill, etc.)
//   - On Windows: try fs.symlink with type='junction' first (no admin needed
//     for directories). If EPERM/ENOSYS, fall back to recursive copy.
//   - Idempotent: re-running fixes stale symlinks, leaves user copies alone.

import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

// Harness skill directories (per published docs as of 2026-05).
// Order: canonical first, then per-harness.
export const HARNESS_DIRS = [
  path.join(home, '.agents', 'skills'),       // OpenCode + GH Copilot CLI canonical
  path.join(home, '.claude', 'skills'),       // Claude Code
  path.join(home, '.codex', 'skills'),        // OpenAI Codex CLI
  path.join(home, '.pi', 'agent', 'skills'),  // Pi Coding Agent
];

// Legacy names from earlier versions that should be removed on upgrade.
const LEGACY_NAMES = ['tavily', 'surf', 'tvly'];

export async function symlinkOrCopy(target, link) {
  // If link already exists, decide whether to replace it.
  if (existsSync(link)) {
    try {
      const stat = await fs.lstat(link);
      if (stat.isSymbolicLink()) {
        const cur = await fs.readlink(link);
        if (path.resolve(cur) === path.resolve(target)) return { action: 'kept-symlink' };
        await fs.unlink(link);
      } else {
        // User has a non-symlink there (probably their own copy). Leave alone.
        return { action: 'preserved-existing' };
      }
    } catch (e) {
      // lstat failed; assume the path is corrupt — try to remove.
      try { await fs.rm(link, { recursive: true, force: true }); } catch {}
    }
  }

  // Try symlink first (junction on Windows works without admin).
  try {
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(target, link, type);
    return { action: 'symlinked' };
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'ENOSYS' && e.code !== 'EEXIST') {
      throw e;
    }
    // Fallback: recursive copy (Windows without dev mode).
    await fs.cp(target, link, { recursive: true });
    return { action: 'copied' };
  }
}

export async function unlinkIfOurs(link, expectedTarget) {
  if (!existsSync(link)) return false;
  try {
    const stat = await fs.lstat(link);
    if (stat.isSymbolicLink()) {
      const cur = await fs.readlink(link);
      if (path.resolve(cur) === path.resolve(expectedTarget)) {
        await fs.unlink(link);
        return true;
      }
      return false;
    }
    // Non-symlink: likely a user copy. Don't delete.
    return false;
  } catch {
    return false;
  }
}

export async function installSkill(pkgRoot) {
  const results = [];
  for (const dir of HARNESS_DIRS) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const link = path.join(dir, 'surf-skill');
      const r = await symlinkOrCopy(pkgRoot, link);
      results.push({ dir: link, ...r });
    } catch (e) {
      results.push({ dir, action: 'error', error: e.message });
    }
  }
  return results;
}

export async function uninstallSkill(pkgRoot) {
  const results = [];
  for (const dir of HARNESS_DIRS) {
    const link = path.join(dir, 'surf-skill');
    try {
      const removed = await unlinkIfOurs(link, pkgRoot);
      results.push({ dir: link, removed });
    } catch (e) {
      results.push({ dir: link, removed: false, error: e.message });
    }
  }
  return results;
}

export async function cleanupLegacy() {
  const results = [];
  for (const dir of HARNESS_DIRS) {
    for (const name of LEGACY_NAMES) {
      const link = path.join(dir, name);
      // Use lstat (not existsSync) so we also catch broken symlinks pointing
      // at paths that no longer exist (e.g. from a removed prior install).
      try {
        const stat = await fs.lstat(link);
        if (stat.isSymbolicLink()) {
          await fs.unlink(link);
          results.push({ removed: link });
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  return results;
}

export async function ensureKeysSkeleton() {
  const cfgDir = path.join(home, '.config', 'surf');
  await fs.mkdir(cfgDir, { recursive: true });
  const file = path.join(cfgDir, 'keys.json');
  if (!existsSync(file)) {
    const skeleton = {
      schema_version: 1,
      tavily: { keys: [], current: 0, burned: [] },
      parallel: { keys: [], current: 0, burned: [] },
      last_ok_provider: null,
    };
    await fs.writeFile(file, JSON.stringify(skeleton, null, 2) + '\n');
    if (process.platform !== 'win32') {
      try { await fs.chmod(file, 0o600); } catch {}
    }
    return { created: file };
  }
  return { existed: file };
}
