#!/usr/bin/env node
// surf-search-skill — multi-provider web-skill CLI. Routes search/extract/crawl/map/research
// across Tavily and Parallel AI with automatic key + provider fallback.

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { parseFlags, sleep } from '../src/lib/flags.mjs';
import { dispatch, DispatchError } from '../src/lib/dispatch.mjs';
import { formatFor } from '../src/lib/format.mjs';
import { runKeysSubcommand } from '../src/lib/keys-cmd.mjs';
import { cacheClear } from '../src/lib/cache.mjs';
import { readUsage, USAGE_LOG } from '../src/lib/audit.mjs';
import { migrateLegacy } from '../src/lib/state.mjs';
import { runSetup } from '../src/lib/setup.mjs';
import { runProjectConfig, formatProjectConfigResult } from '../src/lib/project-config.mjs';
import { providerFromRequestId } from '../src/lib/providers/index.mjs';
import { progress, setSilent } from '../src/lib/progress.mjs';

const VERSION = '4.1.0';

// Catch SIGTERM/SIGINT so a harness-driven kill surfaces a useful message
// instead of dying silently. This is defense-in-depth: dispatch already
// tries to abort early via the self-budget check.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    process.stderr.write(
      `❌ Error [KilledBySignal]: surf-search-skill received ${sig}. ` +
      `If this came from the agent's bash timeout, run 'surf-search-skill project-config' ` +
      `in this project to raise the limit, or use 'research-start' + 'research-poll' for long jobs.\n`
    );
    process.exit(143); // 128 + 15 (SIGTERM convention)
  });
}

const HELP = `surf-search-skill — multi-provider web skill (Tavily + Parallel AI)

Commands:
  setup                       Interactive onboarding wizard (TTY required)
  project-config [--harness <copilot|claude|pi|all>] [--yes]
                              Write per-project bash-timeout config so the
                              harness used in this project doesn't kill us.
                              Auto-detects via .github/, .claude/, .pi/.
                              REQUIRED for GH Copilot CLI projects.
  search <q> [<q2> ...]       Web search. Multiple positional args = batch
                              (sequential, partial failures reported inline).
  extract <url> [url ...]     Fetch & extract content from URLs
  crawl <url>                 Crawl a site (Tavily only)
  map <url>                   Discover URLs on a site (Tavily only)
  research <topic>            Sync deep research (~50s budget)
  research-start <topic>      Start async research; returns request_id
  research-poll <request_id>  Poll a research job
  usage --provider <name>     Account usage (per provider)
  cache-clear                 Purge response cache
  cost [--reset]              Local credit ledger
  keys <add|remove|list|reset|clear> [...]

Global flags:
  --provider <tavily|parallel|brave>  Force provider, disables fallback
  --mode <fast|normal|slow>      Search tier (per-provider mapping):
                                   fast   = Tavily depth=fast   / Brave count=5
                                   normal = Tavily depth=basic  / Brave count=10 (default)
                                   slow   = Tavily depth=advanced / Brave count=20
                                   Parallel ignores (single mode).
  --no-fallback                  Stay on default provider, no cross-provider fallback
  --no-cache                     Skip response cache
  --json                         Print normalized envelope as JSON
  --raw-json                     Print raw provider response (bypasses cache)
  --confirm-expensive            Allow operations estimated > 10 credits
  --quiet                        Silence progress logs (stderr)
  --help, -h                     Show this help
  --version, -v                  Show version

Progress logs (stderr):
  surf-search-skill emits one line per event to stderr, e.g.:
    [surf 17:58:12] ▸ search → tavily (key #0)
    [surf 17:58:14] ✓ search tavily 1234ms (2 credits)
  Format is stable for agent parsing. Use --quiet or SURF_QUIET=1 to silence.

Examples:
  surf-search-skill setup
  surf-search-skill search "claude 4.7 release notes" --max 3
  surf-search-skill search "topic A" "topic B" "topic C"      # batch (3 queries)
  surf-search-skill extract https://docs.anthropic.com/...
  surf-search-skill research-start "compare X and Y" --model pro --confirm-expensive
  surf-search-skill keys add --provider tavily tvly-...
  surf-search-skill keys list

Key & state are stored in ~/.config/surf/keys.json (chmod 600).
Docs: ~/.agents/skills/surf-search-skill/SKILL.md`;

function die(msg, code = 1) {
  process.stderr.write(`❌ Error: ${msg}\n`);
  process.exit(code);
}

function out(msg) {
  if (msg == null) return;
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  process.stdout.write(s + (s.endsWith('\n') ? '' : '\n'));
}

function emitResult(envelope, flags) {
  if (flags['raw-json']) {
    out(JSON.stringify(envelope.raw, null, 2));
    return;
  }
  if (flags.json) {
    out(JSON.stringify({
      provider: envelope.provider,
      operation: envelope.operation,
      latency_ms: envelope.latency_ms,
      usage: envelope.usage,
      data: envelope.data,
    }, null, 2));
    return;
  }
  out(formatFor(envelope));
}

function buildSearchArgs(query, flags) {
  // --mode is the canonical flag. --depth (Tavily-ism) is still accepted as
  // legacy alias; if neither is set, default to depth='advanced' (Tavily) which
  // also resolves to mode='slow' on Brave.
  return {
    query,
    mode: flags.mode,
    depth: flags.depth || (flags.mode ? undefined : 'advanced'),
    max: flags.max,
    topic: flags.topic,
    time: flags.time,
    startDate: flags['start-date'],
    endDate: flags['end-date'],
    domains: flags.domains,
    excludeDomains: flags.exclude,
    country: flags.country,
    answer: flags.answer,
    raw: flags.raw,
    images: flags.images,
    imageDesc: flags['image-desc'],
    favicon: flags.favicon,
    auto: flags.auto,
    exactMatch: flags['exact-match'],
    processor: flags.processor,
  };
}

async function cmdSearch(pos, flags) {
  if (!pos.length) die('Usage: surf-search-skill search "query" [more queries ...]');

  // Backward-compat: 1 positional arg = exactly one query (same as before).
  if (pos.length === 1) {
    const args = buildSearchArgs(pos[0], flags);
    emitResult(await dispatch('search', args, flags), flags);
    return;
  }

  // Batch mode: each positional arg is an independent query.
  // Runs sequentially to avoid hammering one provider/key with N concurrent
  // calls (which would trigger 429 rate limits).
  await runSearchBatch(pos, flags);
}

async function runSearchBatch(queries, flags) {
  progress.start(`batch: ${queries.length} queries`);
  const batches = [];
  let okCount = 0;
  let failCount = 0;
  let totalCredits = 0;
  const t0 = Date.now();

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const label = `[${i + 1}/${queries.length}] "${q}"`;
    progress.start(label);
    const args = buildSearchArgs(q, flags);
    try {
      const env = await dispatch('search', args, flags);
      okCount++;
      const credits = env.usage && env.usage.credits;
      if (credits != null) totalCredits += credits;
      batches.push({
        index: i,
        query: q,
        ok: true,
        provider: env.provider,
        latency_ms: env.latency_ms,
        usage: env.usage,
        data: env.data,
        raw: env.raw,
      });
    } catch (e) {
      failCount++;
      const code = e.code || e.name || 'Error';
      progress.fail(`${label} failed: [${code}] ${e.message || e}`);
      batches.push({
        index: i,
        query: q,
        ok: false,
        error: { code, message: e.message || String(e), details: e.details },
      });
    }
  }

  const elapsed = Date.now() - t0;
  progress.done(`batch done: ${okCount}/${queries.length} ok, ${failCount} failed (${elapsed}ms, ${totalCredits} credits)`);

  emitBatchResult({
    operation: 'search-batch',
    summary: { total: queries.length, succeeded: okCount, failed: failCount, total_credits: totalCredits, latency_ms: elapsed },
    batches,
  }, flags);

  // Exit non-zero only when EVERY query failed.
  if (okCount === 0 && failCount > 0) process.exitCode = 1;
}

function emitBatchResult(payload, flags) {
  if (flags['raw-json']) {
    out(JSON.stringify(payload.batches.map(b => b.raw ?? b.error), null, 2));
    return;
  }
  if (flags.json) {
    // Strip `raw` from JSON output unless explicitly asked.
    const safe = {
      operation: payload.operation,
      summary: payload.summary,
      data: { batches: payload.batches.map(({ raw, ...rest }) => rest) },
    };
    out(JSON.stringify(safe, null, 2));
    return;
  }
  // Markdown
  const { summary, batches } = payload;
  let md = `# Search batch (${summary.total} queries · ${summary.succeeded} ok · ${summary.failed} failed)\n\n`;
  md += `_total: ${summary.total_credits} credits · ${summary.latency_ms}ms_\n\n`;
  for (const b of batches) {
    md += `---\n\n## [${b.index + 1}/${summary.total}] ${b.query}\n\n`;
    if (!b.ok) {
      md += `**❌ Failed:** \`[${b.error.code}]\` ${b.error.message}\n\n`;
      continue;
    }
    md += `_provider: ${b.provider} · ${b.latency_ms}ms`;
    if (b.usage && b.usage.credits != null) md += ` · ${b.usage.credits} credits`;
    md += `_\n\n`;
    const r = b.data;
    if (r.answer) md += `**Answer:** ${r.answer}\n\n`;
    (r.results || []).forEach((it, i) => {
      md += `### [${i + 1}] ${it.title || it.url}\n${it.url}\n`;
      if (it.score != null) md += `*score: ${typeof it.score === 'number' ? it.score.toFixed(2) : it.score}*\n`;
      if (it.published_date) md += `*published: ${it.published_date}*\n`;
      const content = it.content || '';
      md += `\n${content.length > 1500 ? content.slice(0, 1500) + '…' : content}\n\n`;
    });
  }
  out(md);
}

async function cmdExtract(pos, flags) {
  if (!pos.length) die('Usage: surf-search-skill extract <url1> [url2 ...]');
  if (pos.length > 20) die('extract supports at most 20 URLs per call.');
  const args = {
    urls: pos,
    depth: flags.depth || 'basic',
    format: flags.format || 'markdown',
    images: flags.images,
    favicon: flags.favicon,
    query: flags.query,
    chunks: flags.chunks,
    extractTimeout: flags['extract-timeout'],
  };
  emitResult(await dispatch('extract', args, flags), flags);
}

async function cmdCrawl(pos, flags) {
  const url = pos[0];
  if (!url) die('Usage: surf-search-skill crawl <url> [flags]');
  const args = {
    url,
    maxDepth: flags['max-depth'],
    maxBreadth: flags['max-breadth'],
    limit: flags.limit,
    instructions: flags.instructions,
    selectPaths: flags['select-paths'],
    selectDomains: flags['select-domains'],
    excludePaths: flags['exclude-paths'],
    excludeDomains: flags['exclude-domains'],
    allowExternal: flags['allow-external'],
    images: flags.images,
    categories: flags.categories,
    extractDepth: flags['extract-depth'] || 'basic',
    format: flags.format || 'markdown',
    query: flags.query,
    chunks: flags.chunks,
    timeout: flags.timeout,
  };
  emitResult(await dispatch('crawl', args, flags), flags);
}

async function cmdMap(pos, flags) {
  const url = pos[0];
  if (!url) die('Usage: surf-search-skill map <url> [flags]');
  const args = {
    url,
    maxDepth: flags['max-depth'],
    maxBreadth: flags['max-breadth'],
    limit: flags.limit,
    instructions: flags.instructions,
    selectPaths: flags['select-paths'],
    selectDomains: flags['select-domains'],
    excludePaths: flags['exclude-paths'],
    excludeDomains: flags['exclude-domains'],
    allowExternal: flags['allow-external'],
    categories: flags.categories,
    timeout: flags.timeout,
  };
  emitResult(await dispatch('map', args, flags), flags);
}

async function cmdResearchStart(pos, flags) {
  const input = pos.join(' ').trim();
  if (!input) die('Usage: surf-search-skill research-start "topic" [--model mini|auto|pro]');
  const args = {
    input,
    model: flags.model || 'auto',
    citationFormat: flags.citations || 'numbered',
    outputSchema: flags.schema ? JSON.parse(await readFile(flags.schema, 'utf8')) : undefined,
    processor: flags.processor,
  };
  const envelope = await dispatch('research-start', args, flags);
  await persistResearchHandle(envelope);
  emitResult(envelope, flags);
}

async function cmdResearchPoll(pos, flags) {
  const id = pos[0];
  if (!id) die('Usage: surf-search-skill research-poll <request_id>');
  const decoded = providerFromRequestId(id);
  if (!decoded) die(`unknown request_id prefix in '${id}' (expected tvly:... or pllx:...)`);
  const envelope = await dispatch('research-poll', {}, { ...flags, __requestId: id });
  if (envelope.data.status === 'completed' || envelope.data.status === 'failed') {
    try { await unlink(`/tmp/surf-${id.replace(':', '_')}.json`); } catch {}
  }
  emitResult(envelope, flags);
}

async function cmdResearch(pos, flags) {
  const input = pos.join(' ').trim();
  if (!input) die('Usage: surf-search-skill research "topic"');
  const model = flags.model || 'mini';
  if (model === 'pro' || model === 'ultra') {
    die(`Refusing sync research with model=${model} (would exceed timeout). Use 'surf-search-skill research-start' + 'surf-search-skill research-poll'.`);
  }
  const startArgs = {
    input,
    model,
    citationFormat: flags.citations || 'numbered',
    processor: flags.processor,
  };
  const start = await dispatch('research-start', startArgs, flags);
  await persistResearchHandle(start);
  const id = start.data.request_id;
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const poll = await dispatch('research-poll', {}, { ...flags, __requestId: id });
    if (poll.data.status === 'completed' || poll.data.status === 'failed') {
      try { await unlink(`/tmp/surf-${id.replace(':', '_')}.json`); } catch {}
      emitResult(poll, flags);
      return;
    }
  }
  out(`**Research did not finish in 50s.** Continue with: \`surf-search-skill research-poll ${id}\``);
}

async function persistResearchHandle(envelope) {
  try {
    const id = envelope.data.request_id;
    await mkdir('/tmp', { recursive: true }).catch(() => {});
    await writeFile(`/tmp/surf-${id.replace(':', '_')}.json`, JSON.stringify({
      started: Date.now(),
      provider: envelope.provider,
      request_id: id,
    }));
  } catch {}
}

async function cmdUsage(_pos, flags) {
  if (!flags.provider) die(`Usage: surf-search-skill usage --provider <tavily|parallel>`);
  emitResult(await dispatch('usage', {}, flags), flags);
}

async function cmdCacheClear() {
  const n = await cacheClear();
  out(`Cleared ${n} cache entr${n === 1 ? 'y' : 'ies'}.`);
}

async function cmdCost(_pos, flags) {
  if (flags.reset) {
    try { await unlink(USAGE_LOG); } catch {}
    out('Reset local usage ledger.');
    return;
  }
  const entries = await readUsage();
  const total = entries.reduce((s, e) => s + (Number(e.credits) || 0), 0);
  const live = entries.filter(e => !e.cached);
  const hits = entries.filter(e => e.cached).length;
  const byProvider = {};
  for (const e of entries) {
    const p = e.provider || 'unknown';
    byProvider[p] = (byProvider[p] || 0) + (Number(e.credits) || 0);
  }
  if (flags.json) {
    out(JSON.stringify({
      totalCredits: total, byProvider,
      entries: entries.length, liveCalls: live.length, cacheHits: hits,
      recent: entries.slice(-20),
    }, null, 2));
    return;
  }
  let md = `**Local recorded credits:** ${total}\n`;
  for (const p of Object.keys(byProvider)) md += `- ${p}: ${byProvider[p]}\n`;
  md += `\n- live API calls: ${live.length}\n- cache hits: ${hits}\n`;
  if (!entries.length) {
    md += '\n_No local usage recorded yet._\n';
  } else {
    md += '\n**Recent calls**\n';
    for (const e of entries.slice(-20)) {
      md += `- ${e.ts} [${e.provider || '?'}] ${e.op}: ${e.credits ?? '—'}${e.cached ? ' (cache hit)' : ''}\n`;
    }
  }
  md += '\nUse `surf-search-skill cost --reset` to clear the local ledger.';
  out(md);
}

async function cmdKeys(pos, flags) {
  const sub = pos[0];
  if (!sub) die('Usage: surf-search-skill keys <add|remove|list|reset|clear> ...');
  const subPos = pos.slice(1);
  try {
    const result = await runKeysSubcommand(sub, subPos, flags);
    if (sub === 'list' || sub === 'ls' || sub === 'status') {
      if (result.json) out(JSON.stringify(result.state, null, 2));
      else out(result.text);
      return;
    }
    if (flags.json) {
      out(JSON.stringify(result, null, 2));
    } else if (sub === 'add') {
      if (result.added) {
        if (result.validation) {
          out(`✓ validated (${result.validation.latency_ms}ms, ${result.validation.credits} credit${result.validation.credits === 1 ? '' : 's'})`);
        }
        out(`✓ added [${result.index}] to ${result.provider}`);
      } else if (result.validation && !result.validation.valid) {
        const { formatValidation } = await import('../src/validators/index.mjs');
        out(formatValidation(result.validation));
        out(`✗ NOT saved (re-run with --skip-validate to add anyway)`);
        process.exitCode = 1;
      } else {
        out(`already exists in ${result.provider} (no-op)`);
      }
    } else if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
      out(`✓ removed index ${result.index} from ${result.provider}`);
    } else if (sub === 'reset') {
      out(`✓ cleared burned for ${result.provider || 'all providers'}`);
    } else if (sub === 'clear') {
      out(`✓ cleared all keys${flags.all ? '' : ' for ' + (flags.provider || '?')}`);
    }
  } catch (e) {
    if (e.code === 'NEEDS_YES') {
      process.stderr.write(`❌ Error: ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }
}

// --- Main ---

await migrateLegacy();

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === '--help' || cmd === '-h') {
  out(HELP); process.exit(0);
}
if (cmd === '--version' || cmd === '-v') {
  out(VERSION); process.exit(0);
}

const { pos, flags } = parseFlags(rest);

// Wire --quiet before any progress event fires.
if (flags.quiet) setSilent(true);

// Auto-launch setup wizard on first TTY use when no keys are configured.
// Commands that don't need keys (setup, keys, project-config, help, etc.)
// are excluded.
const NO_KEYS_NEEDED = new Set([
  'setup', 'keys', 'project-config',
  'cache-clear', 'cost',
  '--help', '-h', '--version', '-v',
]);
if (!NO_KEYS_NEEDED.has(cmd) && process.stdin.isTTY) {
  try {
    const { loadState } = await import('../src/lib/state.mjs');
    const state = await loadState();
    const hasAny = (state.tavily.keys || []).length || (state.parallel.keys || []).length;
    if (!hasAny) {
      process.stderr.write('No keys configured. Launching setup wizard…\n\n');
      await runSetup();
      process.stderr.write('\n— Resuming your command —\n\n');
    }
  } catch {
    // If anything goes wrong with the auto-wizard, fall through to the
    // normal command which will produce its own actionable error.
  }
}

try {
  switch (cmd) {
    case 'search': await cmdSearch(pos, flags); break;
    case 'extract': await cmdExtract(pos, flags); break;
    case 'crawl': await cmdCrawl(pos, flags); break;
    case 'map': await cmdMap(pos, flags); break;
    case 'research': await cmdResearch(pos, flags); break;
    case 'research-start': await cmdResearchStart(pos, flags); break;
    case 'research-poll': await cmdResearchPoll(pos, flags); break;
    case 'usage': await cmdUsage(pos, flags); break;
    case 'cache-clear': await cmdCacheClear(); break;
    case 'cost': await cmdCost(pos, flags); break;
    case 'keys': await cmdKeys(pos, flags); break;
    case 'setup': await runSetup(); break;
    case 'project-config': {
      const result = await runProjectConfig(pos, flags);
      out(formatProjectConfigResult(result, { json: !!flags.json }));
      break;
    }
    default:
      die(`Unknown command: ${cmd}. Try 'surf-search-skill --help'.`);
  }
} catch (e) {
  if (e instanceof DispatchError) {
    process.stderr.write(`❌ Error [${e.code}]: ${e.message}\n`);
    if (e.code === 'NoProviderAvailable' && process.stdin.isTTY) {
      process.stderr.write(`→ Run 'surf-search-skill setup' to configure keys interactively.\n`);
    }
    process.exit(1);
  }
  if (e.code === 'PROJECT_CONFIG_NO_TTY' || e.code === 'PROJECT_CONFIG_BAD_HARNESS') {
    process.stderr.write(`❌ Error: ${e.message}\n`);
    process.exit(2);
  }
  if (e.code === 'NO_TTY') {
    process.stderr.write(`❌ Error: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`❌ Error: ${e.message || String(e)}\n`);
  process.exit(1);
}
