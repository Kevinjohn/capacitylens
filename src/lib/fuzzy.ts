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

/** Fold canonically decomposable diacritics and case for search comparisons. The fixed NFD form
 * and Unicode-property regex are total for arbitrary strings, including lone surrogate code units.
 * Exported so other search surfaces fold IDENTICALLY rather than keeping a private copy that could
 * drift from what the palette actually matches on. */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** A "word" starts after a space, hyphen, or underscore, or is the string start; the capture is the
 * first character of that word. Hoisted to module scope so a filter over N items doesn't compile N
 * copies of the same pattern — it is stateful (`/g` keeps `lastIndex`), so every use resets it
 * first. Safe: the scan below is synchronous and calls nothing that could re-enter the scorer. */
const WORD_BOUNDARY_RE = /(?:^|[\s\-_]+)(.)/g;

/** Score an ALREADY-FOLDED query against a raw `text`. Split out so a filter pass folds its query
 *  once instead of once per item; `fuzzyScore` is the folding entry point. */
function scoreFolded(q: string, text: string): number {
  if (!q) return 0;

  const t = foldForSearch(text);

  // Tier 0: exact prefix
  if (t.startsWith(q)) return 0;

  // Tiers 1 and 2 both require `q` to appear contiguously, so a single `includes` gates them: when
  // it fails (the common case while filtering) the word-boundary scan cannot match either and is
  // skipped entirely. Ordering within the gate is unchanged — a word-boundary prefix still beats a
  // mid-word substring.
  if (t.includes(q)) {
    // Tier 1: word-boundary prefix — query starts a word inside the text
    WORD_BOUNDARY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_BOUNDARY_RE.exec(t)) !== null) {
      const wordStart = m.index + (m[0].length - 1); // position of the captured letter
      if (t.startsWith(q, wordStart)) return 1;
    }
    // Tier 2: contiguous substring match anywhere
    return 2;
  }

  // Tier 3: subsequence (every character of query appears in order)
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 3;

  return Infinity;
}

/** Return the score for `query` against `text`, or Infinity if no match.
 *  @remarks Pure and TOTAL — although `query` is untrusted user input, every branch returns a
 *    number and the regex is a fixed pattern over a single capture (no catastrophic backtracking),
 *    so this cannot throw. Do NOT wrap it in try/catch — there's nothing to guard and a wrapper
 *    would only mask a future real bug. */
export function fuzzyScore(query: string, text: string): number {
  return scoreFolded(foldForSearch(query), text);
}

/** Score every item in `items` against `query`, drop non-matches, sort by score. */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  // Fold the query ONCE for the whole pass, and carry each survivor's lower-cased text so the
  // comparator below doesn't re-lower the same strings on every one of its O(n log n) compares.
  const folded = foldForSearch(trimmed);
  const scored: { item: T; tier: number; text: string; lower: string }[] = [];
  for (const item of items) {
    const text = getText(item);
    const tier = scoreFolded(folded, text);
    if (tier === Infinity) continue;
    scored.push({ item, tier, text, lower: text.toLowerCase() });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Within tier: prefer shorter (tighter fit), then alpha
    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    return a.lower.localeCompare(b.lower);
  });

  return scored.map((x) => x.item);
}
