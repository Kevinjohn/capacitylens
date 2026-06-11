/**
 * Dependency-free fuzzy scorer for the command palette.
 *
 * Scoring tiers (lower = better rank):
 *   0 — exact prefix match         "ty"    → "Tyler Nix"
 *   1 — word-boundary prefix match "nix"   → "Tyler Nix"
 *   2 — contiguous match anywhere  "ler"   → "Tyler Nix"
 *   3 — subsequence (scattered)    "tnx"   → "Tyler Nix"
 *   Infinity — no match
 *
 * Within a tier, shorter names rank higher (tighter fit).
 * Tie-break: lexicographic on lower-cased name (stable).
 *
 * All comparisons are case-insensitive; the original text is preserved for display.
 */

export interface FuzzyScore {
  /** Lower = better. `Infinity` = no match at all. */
  score: number
  /** The source text (unmodified). */
  text: string
}

/** Return the score for `query` against `text`, or Infinity if no match. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0

  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // Tier 0: exact prefix
  if (t.startsWith(q)) return 0

  // Tier 1: word-boundary prefix — query starts a word inside the text
  // A "word" starts after a space, hyphen, underscore, or is the string start.
  const wordBoundaryRe = /(?:^|[\s\-_])(.)/g
  let m: RegExpExecArray | null
  while ((m = wordBoundaryRe.exec(t)) !== null) {
    const wordStart = m.index + (m[0].length - 1) // position of the captured letter
    if (t.startsWith(q, wordStart)) return 1
  }

  // Tier 2: contiguous substring match anywhere
  if (t.includes(q)) return 2

  // Tier 3: subsequence (every character of query appears in order)
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi === q.length) return 3

  return Infinity
}

/** Score every item in `items` against `query`, drop non-matches, sort by score. */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (!query.trim()) return items

  const scored = items
    .map((item) => {
      const text = getText(item)
      const tier = fuzzyScore(query.trim(), text)
      return { item, tier, text }
    })
    .filter((x) => x.tier < Infinity)

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    // Within tier: prefer shorter (tighter fit), then alpha
    if (a.text.length !== b.text.length) return a.text.length - b.text.length
    return a.text.toLowerCase().localeCompare(b.text.toLowerCase())
  })

  return scored.map((x) => x.item)
}
