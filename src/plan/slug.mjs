// kebab-case slug from a free-form task title.

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'of', 'in', 'on',
  'at', 'to', 'from', 'by', 'as', 'is', 'are', 'be', 'do', 'does',
]);

/**
 * Build a deterministic kebab-case slug from a task title.
 * - lowercases
 * - strips diacritics (ã → a)
 * - removes punctuation
 * - drops short stop words
 * - joins with `-`
 * - max 50 chars (truncates on word boundary when possible)
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  if (!title || typeof title !== 'string') return 'untitled';
  // Strip diacritics: NFD + remove combining marks.
  const ascii = title.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tokens = ascii
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !STOP_WORDS.has(t));
  if (!tokens.length) return 'untitled';
  let slug = tokens.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slug.length > 50) {
    // Truncate on a hyphen if possible.
    slug = slug.slice(0, 50);
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > 20) slug = slug.slice(0, lastHyphen);
  }
  return slug || 'untitled';
}

/**
 * Build a filename: `<slug>-<YYYYMMDD-HHMM>.md`.
 *
 * @param {string} title
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function planFilename(title, now = new Date()) {
  const slug = slugify(title);
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  return `${slug}-${y}${mo}${d}-${h}${mi}.md`;
}
