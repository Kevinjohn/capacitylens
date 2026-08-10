/**
 * Dependency-free fuzzy scorer for the command palette.
 *
 * Scoring tiers (lower = better rank):
 *   0 — exact prefix match         "br"    → "Bruce Wayne"
 *   1 — word-boundary prefix match "way"   → "Bruce Wayne"
 *   2 — contiguous match anywhere  "uce"   → "Bruce Wayne"
 *   3 — subsequence (scattered)    "bwn"   → "Bruce Wayne"
 *   Infinity — no match
 *
 * Within a tier, shorter names rank higher (tighter fit).
 * Tie-break: lexicographic on lower-cased name (stable).
 *
 * All comparisons are case- and diacritic-insensitive; the original text is preserved for display.
 */

export interface FuzzyScore {
  /** Lower = better. `Infinity` = no match at all. */
  score: number;
  /** The source text (unmodified). */
  text: string;
}

/** Fold canonically decomposable diacritics and case for search comparisons. The fixed NFD form
 * and Unicode-property regex are total for arbitrary strings, including lone surrogate code units. */
function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Return the score for `query` against `text`, or Infinity if no match.
 *  @remarks Pure and TOTAL — although `query` is untrusted user input, every branch returns a
 *    number and the regex is a fixed pattern over a single capture (no catastrophic backtracking),
 *    so this cannot throw. Do NOT wrap it in try/catch — there's nothing to guard and a wrapper
 *    would only mask a future real bug. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;

  const q = foldForSearch(query);
  const t = foldForSearch(text);

  // Tier 0: exact prefix
  if (t.startsWith(q)) return 0;

  // Tier 1: word-boundary prefix — query starts a word inside the text
  // A "word" starts after a space, hyphen, underscore, or is the string start.
  const wordBoundaryRe = /(?:^|[\s\-_]+)(.)/g;
  let m: RegExpExecArray | null;
  while ((m = wordBoundaryRe.exec(t)) !== null) {
    const wordStart = m.index + (m[0].length - 1); // position of the captured letter
    if (t.startsWith(q, wordStart)) return 1;
  }

  // Tier 2: contiguous substring match anywhere
  if (t.includes(q)) return 2;

  // Tier 3: subsequence (every character of query appears in order)
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 3;

  return Infinity;
}

/** Score every item in `items` against `query`, drop non-matches, sort by score. */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  if (!query.trim()) return items;

  const scored = items
    .map((item) => {
      const text = getText(item);
      const tier = fuzzyScore(query.trim(), text);
      return { item, tier, text };
    })
    .filter((x) => x.tier < Infinity);

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Within tier: prefer shorter (tighter fit), then alpha
    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    return a.text.toLowerCase().localeCompare(b.text.toLowerCase());
  });

  return scored.map((x) => x.item);
}
