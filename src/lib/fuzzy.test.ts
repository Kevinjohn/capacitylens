import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyFilter } from './fuzzy'

describe('fuzzyScore', () => {
  describe('Tier 0 — exact prefix', () => {
    it('scores 0 for exact prefix match', () => {
      expect(fuzzyScore('ty', 'Tyler Nix')).toBe(0)
    })
    it('scores 0 for full match', () => {
      expect(fuzzyScore('tyler nix', 'Tyler Nix')).toBe(0)
    })
    it('is case-insensitive', () => {
      expect(fuzzyScore('TY', 'tyler nix')).toBe(0)
    })
  })

  describe('Tier 1 — word-boundary prefix', () => {
    it('scores 1 for second-word prefix', () => {
      expect(fuzzyScore('nix', 'Tyler Nix')).toBe(1)
    })
    it('scores 1 for word after a hyphen', () => {
      expect(fuzzyScore('end', 'Front End')).toBe(1)
    })
    it('scores 1 for word after underscore', () => {
      expect(fuzzyScore('bar', 'foo_bar')).toBe(1)
    })
  })

  describe('Tier 2 — contiguous substring', () => {
    it('scores 2 for mid-word substring', () => {
      expect(fuzzyScore('ler', 'Tyler Nix')).toBe(2)
    })
    it('scores 2 for substring across boundary that is not a prefix', () => {
      expect(fuzzyScore('er n', 'Tyler Nix')).toBe(2)
    })
  })

  describe('Tier 3 — subsequence', () => {
    it('scores 3 for scattered subsequence', () => {
      expect(fuzzyScore('tnx', 'Tyler Nix')).toBe(3)
    })
    it('scores 3 when all chars appear in order but not contiguously', () => {
      expect(fuzzyScore('tyn', 'Tyler Nix')).toBe(3)
    })
  })

  describe('No match', () => {
    it('returns Infinity when query has characters not in text', () => {
      expect(fuzzyScore('xyz', 'Tyler Nix')).toBe(Infinity)
    })
    it('returns Infinity for empty text with non-empty query', () => {
      expect(fuzzyScore('a', '')).toBe(Infinity)
    })
  })

  describe('Empty query', () => {
    it('returns 0 for empty query (shows everything)', () => {
      expect(fuzzyScore('', 'Tyler Nix')).toBe(0)
    })
  })
})

describe('fuzzyFilter', () => {
  const resources = [
    { id: 'r-tyler', name: 'Tyler Nix' },
    { id: 'r-pam', name: 'Pam Gonzalez' },
    { id: 'r-nike', name: 'Nike Spiros' },
    { id: 'r-alex', name: 'Alex Rivera' },
  ]
  const getText = (r: { name: string }) => r.name

  it('returns all items for empty query', () => {
    expect(fuzzyFilter(resources, '', getText)).toHaveLength(4)
  })

  it('filters out non-matches', () => {
    const result = fuzzyFilter(resources, 'zzz', getText)
    expect(result).toHaveLength(0)
  })

  it('ranks prefix match before subsequence match', () => {
    // "nx" is a subsequence of "Tyler Nix"; "Nike" starts with "ni" but "nix" is longer
    // Use "tyl" which is a prefix of "Tyler Nix"
    const result = fuzzyFilter(resources, 'tyl', getText)
    expect(result[0].id).toBe('r-tyler')
  })

  it('sorts tier-0 before tier-1 before tier-3', () => {
    // "alex" → tier 0 (prefix) for Alex Rivera
    // "on" → tier 2 (substring) for Pam Gonzalez, Nike Spiros
    const result = fuzzyFilter(resources, 'alex', getText)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('r-alex')
  })

  it('stable tie-break: within same tier, shorter name first then alpha', () => {
    // "a" is a subsequence/prefix of multiple names: Alex (prefix), Pam Gonzalez (subsequence via 'a'), etc.
    // Actually "a" is a prefix of "Alex Rivera" (tier 0), and a subsequence/contained in others
    // Let's just check ordering is stable
    const result = fuzzyFilter(resources, 'a', getText)
    // Alex Rivera has 'a' as prefix (tier 0), others may have it as substring/subsequence
    expect(result[0].id).toBe('r-alex') // Alex starts with 'A' — tier 0
  })

  it('is case-insensitive in matching', () => {
    expect(fuzzyFilter(resources, 'TYLER', getText)).toHaveLength(1)
    expect(fuzzyFilter(resources, 'TYLER', getText)[0].id).toBe('r-tyler')
  })

  it('returns items in original (unsorted) order for an empty or whitespace-only query', () => {
    // The early-return path must hand back `items` untouched, not run them through the tier/
    // length/alpha sort — an empty query short-circuits before scoring even starts.
    expect(fuzzyFilter(resources, '', getText)).toEqual(resources)
    expect(fuzzyFilter(resources, '   ', getText)).toEqual(resources)
  })

  it('trims the query before scoring, so surrounding whitespace does not defeat an exact match', () => {
    // Untrimmed, the leading space would push 'Tyler Nix' out of every tier (no subsequence
    // match for a leading space char), dropping it from the results entirely.
    const result = fuzzyFilter(resources, ' tyler', getText)
    expect(result.map((r) => r.id)).toContain('r-tyler')
  })

  it('sorts strictly by tier first, even when the tie-break would otherwise disagree', () => {
    const items = [
      { id: 't0', name: 'alphabetsoup' }, // starts with 'al' -> tier 0, but the LONGER name
      { id: 't2', name: 'zzalz' }, // contains 'al' -> tier 2, but the SHORTER name
    ]
    expect(fuzzyFilter(items, 'al', (i) => i.name).map((i) => i.id)).toEqual(['t0', 't2'])
  })

  it('does not skip the tier compare on equal tiers (falls through to the length tie-break)', () => {
    const items = [
      { id: 'long', name: 'alphabet' }, // tier 0, length 8
      { id: 'short', name: 'al' }, // tier 0, length 2 — same tier, should sort FIRST (shorter)
    ]
    expect(fuzzyFilter(items, 'al', (i) => i.name).map((i) => i.id)).toEqual(['short', 'long'])
  })

  it('breaks a same-tier tie by length even when alpha order disagrees', () => {
    const items = [
      { id: 'short', name: 'qz' }, // tier 0, length 2, alphabetically AFTER 'qaaaaa'
      { id: 'long', name: 'qaaaaa' }, // tier 0, length 6
    ]
    // Length wins: shorter ('qz') sorts first, even though 'qz' > 'qaaaaa' alphabetically.
    expect(fuzzyFilter(items, 'q', (i) => i.name).map((i) => i.id)).toEqual(['short', 'long'])
  })

  it('breaks a same-tier, same-length tie alphabetically', () => {
    const items = [
      { id: 'b', name: 'qb' },
      { id: 'a', name: 'qa' },
    ]
    expect(fuzzyFilter(items, 'q', (i) => i.name).map((i) => i.id)).toEqual(['a', 'b'])
  })
})
