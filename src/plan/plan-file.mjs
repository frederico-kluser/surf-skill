// Read, write, and list plan files.

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { resolvePlansDir } from './plans-dir.mjs';
import { planFilename, slugify } from './slug.mjs';

/**
 * Write a plan file. Returns the absolute path written.
 *
 * @param {object} plan
 * @param {string} plan.task - task title (also seeds the slug)
 * @param {string} plan.context - the "why"
 * @param {Array<{name:string, value:string, citation?:number}>} [plan.decisions]
 * @param {Array<string>} [plan.files]
 * @param {Array<string|{title:string, body?:string}>} [plan.steps]
 * @param {Array<string>} [plan.verification]
 * @param {Array<{title:string, url:string}>} [plan.references]
 * @param {object} [opts]
 * @param {string} [opts.dir] - override resolvePlansDir()
 * @param {Date}   [opts.now=new Date()]
 * @returns {Promise<string>} absolute path of the written file
 */
export async function writePlan(plan, opts = {}) {
  if (!plan || typeof plan !== 'object') throw new Error('writePlan: plan object required');
  if (!plan.task || typeof plan.task !== 'string') throw new Error('writePlan: plan.task required');

  const dir = opts.dir || await resolvePlansDir();
  await fs.mkdir(dir, { recursive: true });

  const baseName = planFilename(plan.task, opts.now);
  // Collision avoidance: -2, -3, etc.
  let filePath = path.join(dir, baseName);
  let n = 2;
  while (existsSync(filePath)) {
    const noExt = baseName.replace(/\.md$/, '');
    filePath = path.join(dir, `${noExt}-${n}.md`);
    n++;
  }

  const md = renderPlanMarkdown(plan);
  await fs.writeFile(filePath, md, 'utf8');
  return filePath;
}

function renderPlanMarkdown(plan) {
  const out = [];
  out.push(`# Plan: ${plan.task.trim()}\n`);

  out.push('## Context\n');
  out.push(`${(plan.context || '_TBD — describe why this is being done and what success looks like._').trim()}\n`);

  if (plan.decisions && plan.decisions.length) {
    out.push('\n## Decisions\n');
    for (const d of plan.decisions) {
      const citation = d.citation ? `[^${d.citation}]` : '';
      out.push(`- **${d.name}**: ${d.value}${citation ? ` ${citation}` : ''}`);
    }
    out.push('');
  }

  if (plan.files && plan.files.length) {
    out.push('\n## Files to modify\n');
    for (const f of plan.files) out.push(`- \`${f}\``);
    out.push('');
  }

  if (plan.steps && plan.steps.length) {
    out.push('\n## Implementation steps\n');
    plan.steps.forEach((s, i) => {
      if (typeof s === 'string') {
        out.push(`${i + 1}. ${s}`);
      } else {
        const title = s.title || `Step ${i + 1}`;
        const body = s.body ? ` — ${s.body}` : '';
        out.push(`${i + 1}. **${title}**${body}`);
      }
    });
    out.push('');
  }

  if (plan.verification && plan.verification.length) {
    out.push('\n## Verification\n');
    for (const v of plan.verification) out.push(`- ${v}`);
    out.push('');
  }

  if (plan.references && plan.references.length) {
    out.push('\n## References\n');
    plan.references.forEach((r, i) => {
      const n = i + 1;
      out.push(`[^${n}]: [${r.title}](${r.url})`);
    });
    out.push('');
  }

  return out.join('\n');
}

/**
 * Read a plan file by absolute path or by slug substring (resolves against
 * the active plans dir).
 *
 * @param {string} pathOrSlug
 * @returns {Promise<{path: string, content: string}>}
 */
export async function readPlan(pathOrSlug) {
  let p = pathOrSlug;
  if (!existsSync(p)) {
    const dir = await resolvePlansDir({ ensure: false });
    const matches = (await fs.readdir(dir))
      .filter(f => f.endsWith('.md') && f.includes(pathOrSlug))
      .sort()
      .reverse();
    if (!matches.length) {
      throw new Error(`No plan file found matching '${pathOrSlug}' in ${dir}`);
    }
    p = path.join(dir, matches[0]);
  }
  const content = await fs.readFile(p, 'utf8');
  return { path: p, content };
}

/**
 * List plan files in the active plans dir (newest first).
 *
 * @param {object} [opts]
 * @param {string} [opts.dir] - override resolvePlansDir()
 * @returns {Promise<Array<{path:string, name:string, mtime:Date, size:number, title:string}>>}
 */
export async function listPlans(opts = {}) {
  const dir = opts.dir || await resolvePlansDir({ ensure: false });
  if (!existsSync(dir)) return [];
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
  const out = [];
  for (const name of files) {
    const p = path.join(dir, name);
    const st = await fs.stat(p);
    // Title: first line starting with `# Plan: ` (or just the first line).
    let title = name.replace(/\.md$/, '');
    try {
      const head = (await fs.readFile(p, 'utf8')).split('\n', 5).join('\n');
      const m = head.match(/^#\s*Plan:\s*(.+)$/m);
      if (m) title = m[1].trim();
    } catch {}
    out.push({ path: p, name, mtime: st.mtime, size: st.size, title });
  }
  out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return out;
}

/**
 * Create a stub plan file (mostly empty, with placeholders). Used by
 * `surf-plan-skill new "<task>"` so the user — or the agent — can fill it in.
 *
 * @param {string} task
 * @param {object} [opts]
 * @returns {Promise<string>} absolute path written
 */
export async function newPlanStub(task, opts = {}) {
  return writePlan({
    task,
    context: '_TBD — Phase 1 (project discovery) + Phase 2 (web research) go here._',
    decisions: [],
    files: [],
    steps: [],
    verification: [],
    references: [],
  }, opts);
}
