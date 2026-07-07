// Markdown formatters that consume the NORMALIZED result envelope:
//   { provider, operation, data, usage, latency_ms, raw }

import { trunc } from './flags.mjs';

const MAX_RAW = Number(process.env.SURF_MAX_CONTENT_CHARS || process.env.TAVILY_MAX_CONTENT_CHARS) || 1500;

function footer(envelope) {
  const c = envelope.usage && envelope.usage.credits;
  const bits = [`provider: ${envelope.provider}`];
  if (envelope.latency_ms != null) bits.push(`${envelope.latency_ms}ms`);
  if (c != null) bits.push(`credits: ${c}`);
  return `\n_${bits.join(' · ')}_\n`;
}

export function fmtSearch(envelope) {
  const r = envelope.data;
  let md = `# Search: ${r.query || ''}\n\n`;
  if (r.answer) md += `**Answer:** ${r.answer}\n\n`;
  (r.results || []).forEach((it, i) => {
    md += `## [${i + 1}] ${it.title || it.url}\n${it.url}\n`;
    if (it.score != null) md += `*score: ${typeof it.score === 'number' ? it.score.toFixed(2) : it.score}*\n`;
    if (it.published_date) md += `*published: ${it.published_date}*\n`;
    md += `\n${trunc(it.content || '', MAX_RAW)}\n\n`;
    if (it.raw_content) {
      md += `<details><summary>raw</summary>\n\n${trunc(it.raw_content, 3000)}\n\n</details>\n\n`;
    }
  });
  md += footer(envelope);
  return md;
}

export function fmtExtract(envelope) {
  const r = envelope.data;
  let md = '# Extracted content\n\n';
  (r.results || []).forEach((it, i) => {
    md += `## [${i + 1}] ${it.url}\n`;
    if (it.title) md += `**${it.title}**\n`;
    md += `\n${trunc(it.raw_content, 3000)}\n\n`;
  });
  if (r.failed && r.failed.length) {
    md += `\n**Failed:**\n`;
    for (const f of r.failed) md += `- ${f.url} — ${f.reason}\n`;
  }
  md += footer(envelope);
  return md;
}

export function fmtCrawl(envelope) {
  const r = envelope.data;
  let md = `# Crawl: ${r.base_url || ''}\n\n`;
  (r.results || []).forEach((it, i) => {
    md += `## [${i + 1}] ${it.url}\n\n`;
    if (it.raw_content) md += `${trunc(it.raw_content, MAX_RAW)}\n\n`;
  });
  md += footer(envelope);
  return md;
}

export function fmtMap(envelope) {
  const r = envelope.data;
  let md = `# Map: ${r.base_url || ''}\n\n`;
  for (const u of r.urls || []) md += `- ${u}\n`;
  md += footer(envelope);
  return md;
}

export function fmtResearchStart(envelope) {
  const r = envelope.data;
  return [
    `**Research started**`,
    `- request_id: \`${r.request_id}\``,
    `- model: ${r.model || '—'}`,
    `- status: ${r.status}`,
    '',
    `Poll with: \`surf-research-skill research-poll ${r.request_id}\``,
    footer(envelope),
  ].join('\n');
}

export function fmtResearchPoll(envelope) {
  const r = envelope.data;
  if (r.status !== 'completed') {
    return `Research **${r.status}** (request_id=\`${r.request_id}\`)${r.error ? '\n\nerror: ' + r.error : ''}${footer(envelope)}`;
  }
  let md = `# Research report\n\n${r.content || ''}\n\n`;
  if (r.sources && r.sources.length) {
    md += `## Sources\n`;
    r.sources.forEach((s, i) => { md += `${i + 1}. [${s.title || s.url}](${s.url})\n`; });
  }
  md += footer(envelope);
  return md;
}

export function fmtUsage(envelope) {
  return JSON.stringify(envelope.data, null, 2);
}

export function formatFor(envelope) {
  switch (envelope.operation) {
    case 'search': return fmtSearch(envelope);
    case 'extract': return fmtExtract(envelope);
    case 'crawl': return fmtCrawl(envelope);
    case 'map': return fmtMap(envelope);
    case 'research-start': return fmtResearchStart(envelope);
    case 'research-poll': return fmtResearchPoll(envelope);
    case 'usage': return fmtUsage(envelope);
    default: return JSON.stringify(envelope, null, 2);
  }
}
