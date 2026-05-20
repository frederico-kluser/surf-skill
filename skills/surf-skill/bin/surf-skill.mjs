#!/usr/bin/env node
// surf-skill — multi-provider web-skill CLI. Routes search/extract/crawl/map/research
// across Tavily and Parallel AI with automatic key + provider fallback.

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { parseFlags, sleep } from '../lib/flags.mjs';
import { dispatch, DispatchError } from '../lib/dispatch.mjs';
import { formatFor } from '../lib/format.mjs';
import { runKeysSubcommand } from '../lib/keys-cmd.mjs';
import { cacheClear } from '../lib/cache.mjs';
import { readUsage, USAGE_LOG } from '../lib/audit.mjs';
import { migrateLegacy } from '../lib/state.mjs';
import { runSetup } from '../lib/setup.mjs';
import { providerFromRequestId } from '../lib/providers/index.mjs';

const VERSION = '2.0.0';

const HELP = `surf-skill — multi-provider web skill (Tavily + Parallel AI)

Commands:
  setup                       Interactive onboarding wizard (TTY required)
  search <query>              Web search
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
  --provider <tavily|parallel>   Force provider, disables fallback
  --no-fallback                  Stay on default provider, no cross-provider fallback
  --no-cache                     Skip response cache
  --json                         Print normalized envelope as JSON
  --raw-json                     Print raw provider response (bypasses cache)
  --confirm-expensive            Allow operations estimated > 10 credits
  --help, -h                     Show this help
  --version, -v                  Show version

Examples:
  surf-skill setup
  surf-skill search "claude 4.7 release notes" --max 3
  surf-skill extract https://docs.anthropic.com/...
  surf-skill research-start "compare X and Y" --model pro --confirm-expensive
  surf-skill keys add --provider tavily tvly-...
  surf-skill keys list

Key & state are stored in ~/.config/surf/keys.json (chmod 600).
Docs: ~/.agents/skills/surf-skill/SKILL.md`;

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

async function cmdSearch(pos, flags) {
  const query = pos.join(' ').trim();
  if (!query) die('Usage: surf-skill search "query" [flags]');
  const args = {
    query,
    depth: flags.depth || 'basic',
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
  emitResult(await dispatch('search', args, flags), flags);
}

async function cmdExtract(pos, flags) {
  if (!pos.length) die('Usage: surf-skill extract <url1> [url2 ...]');
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
  if (!url) die('Usage: surf-skill crawl <url> [flags]');
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
  if (!url) die('Usage: surf-skill map <url> [flags]');
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
  if (!input) die('Usage: surf-skill research-start "topic" [--model mini|auto|pro]');
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
  if (!id) die('Usage: surf-skill research-poll <request_id>');
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
  if (!input) die('Usage: surf-skill research "topic"');
  const model = flags.model || 'mini';
  if (model === 'pro' || model === 'ultra') {
    die(`Refusing sync research with model=${model} (would exceed timeout). Use 'surf-skill research-start' + 'surf-skill research-poll'.`);
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
  out(`**Research did not finish in 50s.** Continue with: \`surf-skill research-poll ${id}\``);
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
  if (!flags.provider) die(`Usage: surf-skill usage --provider <tavily|parallel>`);
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
  md += '\nUse `surf-skill cost --reset` to clear the local ledger.';
  out(md);
}

async function cmdKeys(pos, flags) {
  const sub = pos[0];
  if (!sub) die('Usage: surf-skill keys <add|remove|list|reset|clear> ...');
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
      if (result.added) out(`✓ added [${result.index}] to ${result.provider}`);
      else out(`already exists in ${result.provider} (no-op)`);
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
    default:
      die(`Unknown command: ${cmd}. Try 'surf-skill --help'.`);
  }
} catch (e) {
  if (e instanceof DispatchError) {
    process.stderr.write(`❌ Error [${e.code}]: ${e.message}\n`);
    if (e.code === 'NoProviderAvailable' && process.stdin.isTTY) {
      process.stderr.write(`→ Run 'surf-skill setup' to configure keys interactively.\n`);
    }
    process.exit(1);
  }
  if (e.code === 'NO_TTY') {
    process.stderr.write(`❌ Error: ${e.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`❌ Error: ${e.message || String(e)}\n`);
  process.exit(1);
}
