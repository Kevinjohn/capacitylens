// Rank command-palette matches by prefix, word boundary, substring and subsequence,
// then by shorter folded names and lexical order. Preserve original text for display.

/** Folds canonically decomposable diacritics and case for consistent search comparisons.
 * Pure and total for string input, including lone surrogates.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Reuse the boundary regex to avoid compiling it per item. Reset its stateful
// lastIndex before every synchronous, non-reentrant scan.
const WORD_BOUNDARY_RE = /(?:^|[\s\-_]+)(.)/g;

// Fold the query once per filter pass so scoring does not repeat it for every item.
function scoreFolded(query: string, text: string): number {
  if (!query) return 0;

  const foldedText = foldForSearch(text);

  if (foldedText.startsWith(query)) return 0;

  // A failed contiguous match rules out both boundary and substring tiers, avoiding a needless scan.
  if (foldedText.includes(query)) {
    WORD_BOUNDARY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD_BOUNDARY_RE.exec(foldedText)) !== null) {
      const wordStart = match.index + (match[0].length - 1);
      if (foldedText.startsWith(query, wordStart)) return 1;
    }

    return 2;
  }

  let queryIndex = 0;
  for (let textIndex = 0; textIndex < foldedText.length && queryIndex < query.length; textIndex++) {
    if (foldedText[textIndex] === query[queryIndex]) queryIndex++;
  }
  if (queryIndex === query.length) return 3;

  return Infinity;
}

/** Return the score for `query` against `text`, or Infinity if no match.
 * @remarks Pure and total, although `query` is untrusted user input, every branch returns a
 * number and the regex is a fixed pattern over a single capture (no catastrophic backtracking),
 * so this cannot throw. Do not wrap it in try/catch. There's nothing to guard and a wrapper
 * would only mask a future real bug. */
export function fuzzyScore(query: string, text: string): number {
  return scoreFolded(foldForSearch(query), text);
}

/** Score every item in `items` against `query`, drop non-matches, sort by score. */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  // Fold the query once for the whole pass, and carry each survivor's lower-cased text so the
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

    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    return a.lower.localeCompare(b.lower);
  });

  return scored.map((scoredItem) => scoredItem.item);
}
