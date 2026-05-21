// surf-skill — library entry point.
// Named exports for each operation. CLI is at bin/surf-skill.mjs.
//
// Usage:
//   import { search, extract, research } from 'surf-skill';
//   const r = await search('claude api', { max: 3 });
//
// Keys are auto-discovered (opts > process.env > .env > ~/.config/surf/keys.json).
// Pass `tavilyKeys: [...]` / `parallelKeys: [...]` to override.

export { search } from './lib/api/search.mjs';
export { extract } from './lib/api/extract.mjs';
export { crawl } from './lib/api/crawl.mjs';
export { map } from './lib/api/map.mjs';
export {
  research,
  researchStart,
  researchPoll,
} from './lib/api/research.mjs';

export { discoverKeys, buildInMemoryState } from './env.mjs';
export { setSilent } from './lib/progress.mjs';
