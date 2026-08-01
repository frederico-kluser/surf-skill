// Shared surf-ai command implementation.
//
// Three entry points reach the same code path, so they can never drift:
//   surf-search-normal  <question>              (bin)
//   surf-search-unlimit <question>              (bin)
//   surf-research-skill ai <question> --mode …  (subcommand)

import { readFile, writeFile } from 'node:fs/promises';
import { stdout, stderr } from 'node:process';
import { runSurfAi } from './orchestrator.mjs';
import { renderMarkdown, renderJson } from './render.mjs';
import { progress } from '../progress.mjs';

export class AiCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiCliError';
    this.code = 'AI_CLI_USAGE';
  }
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Build the research brief from positionals, flags and an optional JSON file.
 * Positional args are joined, so an unquoted question still works; --brief-file
 * exists because long multi-line insights are miserable to escape in bash.
 */
export async function buildBrief(pos, flags) {
  let brief = {};
  if (flags['brief-file']) {
    let txt;
    try {
      txt = await readFile(flags['brief-file'], 'utf8');
    } catch (e) {
      throw new AiCliError(`--brief-file: cannot read ${flags['brief-file']}: ${e.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      throw new AiCliError(`--brief-file: ${flags['brief-file']} is not valid JSON: ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AiCliError('--brief-file must contain a JSON object');
    }
    brief = parsed;
  }

  const question = str(Array.isArray(pos) ? pos.join(' ') : pos) || str(brief.question);
  if (!question) {
    throw new AiCliError(
      'a question is required.\n' +
      '  surf-search-normal  "<question>" [--task ...] [--goal ...] [--insights ...] [--deliverable ...]\n' +
      '  surf-search-unlimit "<question>" [--max-rounds 6]\n' +
      '  …or pass --brief-file brief.json containing {"question": "...", "task": "...", ...}'
    );
  }

  return {
    question,
    task: str(flags.task) || str(brief.task),
    goal: str(flags.goal) || str(brief.goal),
    insights: str(flags.insights) || str(brief.insights),
    deliverable: str(flags.deliverable) || str(brief.deliverable),
  };
}

/**
 * Run one surf-ai command end to end: brief → research loop → rendered output.
 * Returns the exit code; it never throws for research failures, only for
 * usage errors (AiCliError).
 */
export async function runAiCommand({ pos, flags, mode }) {
  const resolvedMode = mode || (flags.mode === 'unlimit' ? 'unlimit' : 'normal');
  if (!mode && flags.mode && flags.mode !== 'normal' && flags.mode !== 'unlimit') {
    throw new AiCliError(`--mode must be 'normal' or 'unlimit' (got '${flags.mode}')`);
  }

  const ctx = await buildBrief(pos, flags);

  const result = await runSurfAi(ctx, {
    mode: resolvedMode,
    concurrency: flags.concurrency,
    maxRounds: flags['max-rounds'],
    maxQueries: flags['max-queries'],
    max: flags.max,
    aiModel: flags['ai-model'],
    searchMode: flags['search-mode'],
    budgetMs: flags['budget-ms'],
    flags,
  });

  const text = flags.json
    ? JSON.stringify(renderJson(result), null, 2)
    : renderMarkdown(result, { ledger: !!flags.ledger });

  if (typeof flags.out === 'string' && flags.out) {
    try {
      await writeFile(flags.out, text.endsWith('\n') ? text : text + '\n', 'utf8');
      progress.info(`surf-ai: answer written to ${flags.out}`);
    } catch (e) {
      progress.warn(`surf-ai: could not write ${flags.out}: ${e.message}`);
    }
  }

  stdout.write(text.endsWith('\n') ? text : text + '\n');

  // Non-zero ONLY when nothing at all was retrieved. A degraded-but-cited
  // answer is a success: an agent must not retry over it.
  return result.stats.sources === 0 ? 1 : 0;
}

/** Uniform error printer for the two standalone bins. */
export function reportAiError(e) {
  if (e && e.code === 'AI_CLI_USAGE') {
    stderr.write(`❌ Error: ${e.message}\n`);
    return 2;
  }
  if (e && e.code === 'NO_TTY') {
    stderr.write(`❌ Error: ${e.message}\n`);
    return 2;
  }
  stderr.write(`❌ Error${e && e.code ? ` [${e.code}]` : ''}: ${(e && e.message) || String(e)}\n`);
  return 1;
}
