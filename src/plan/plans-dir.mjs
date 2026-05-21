// Resolve where plan files should be written.
//
// Order:
//   1. $SURF_PLAN_DIR env var (explicit override — always wins)
//   2. ./plans/ if it exists in process.cwd()
//   3. ./.surf-plans/ if it exists in process.cwd()
//   4. ~/.claude/plans/ (default; creates the dir if missing)

import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const HOME_PLANS = path.join(HOME, '.claude', 'plans');

export const DEFAULT_HOME_PLANS = HOME_PLANS;

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd=process.cwd()]
 * @param {boolean} [opts.ensure=true] - create the directory if it doesn't exist
 * @returns {Promise<string>}
 */
export async function resolvePlansDir(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const ensure = opts.ensure !== false;

  // 1. Explicit override.
  if (process.env.SURF_PLAN_DIR) {
    const p = path.resolve(process.env.SURF_PLAN_DIR);
    if (ensure) await fs.mkdir(p, { recursive: true });
    return p;
  }

  // 2. Project-level ./plans/
  const projectPlans = path.join(cwd, 'plans');
  if (existsSync(projectPlans)) return projectPlans;

  // 3. Hidden ./.surf-plans/
  const hidden = path.join(cwd, '.surf-plans');
  if (existsSync(hidden)) return hidden;

  // 4. Default ~/.claude/plans/
  if (ensure) await fs.mkdir(HOME_PLANS, { recursive: true });
  return HOME_PLANS;
}
