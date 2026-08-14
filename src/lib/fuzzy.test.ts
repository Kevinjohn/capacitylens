import { describe, it, expect } from "vitest";
import { foldForSearch, fuzzyScore, fuzzyFilter } from "./fuzzy";

describe("foldForSearch", () => {
  it("lower-cases and strips canonically decomposable diacritics", () => {
    expect(foldForSearch("José ÁLVAREZ")).toBe("jose alvarez");
    expect(foldForSearch("Müller")).toBe("muller");
  });

  it("is total for lone surrogates and leaves undecomposable text alone", () => {
    expect(foldForSearch("\ud800")).toBe("\ud800");
    expect(foldForSearch("Bruce Wayne")).toBe("bruce wayne");
  });
});

describe("fuzzyScore", () => {
  describe("Tier 0 — exact prefix", () => {
    it("scores 0 for exact prefix match", () => {
      expect(fuzzyScore("br", "Bruce Wayne")).toBe(0);
    });
    it("scores 0 for full match", () => {
      expect(fuzzyScore("bruce wayne", "Bruce Wayne")).toBe(0);
    });
    it("is case-insensitive", () => {
      expect(fuzzyScore("BR", "bruce wayne")).toBe(0);
    });
    it("is diacritic-insensitive in either direction and across Unicode forms", () => {
      expect(fuzzyScore("jose", "José Alvarez")).toBe(0);
      expect(fuzzyScore("MÜLLER", "Muller")).toBe(0);
      expect(fuzzyScore("Jose\u0301", "José Alvarez")).toBe(0);
    });
  });

  describe("Tier 1 — word-boundary prefix", () => {
    it("scores 1 for second-word prefix", () => {
      expect(fuzzyScore("way", "Bruce Wayne")).toBe(1);
    });
    it("scores 1 for word after a hyphen", () => {
      expect(fuzzyScore("end", "Front End")).toBe(1);
    });
    it("scores 1 for word after underscore", () => {
      expect(fuzzyScore("bar", "foo_bar")).toBe(1);
    });
    it.each(["foo--bar", "foo  bar", "foo- _bar"])(
      "treats a consecutive delimiter run in %s as one word boundary",
      (text) => {
        expect(fuzzyScore("bar", text)).toBe(1);
      },
    );
  });

  describe("Tier 2 — contiguous substring", () => {
    it("scores 2 for mid-word substring", () => {
      expect(fuzzyScore("uce", "Bruce Wayne")).toBe(2);
    });
    it("scores 2 for substring across boundary that is not a prefix", () => {
      expect(fuzzyScore("ce way", "Bruce Wayne")).toBe(2);
    });
  });

  describe("Tier 3 — subsequence", () => {
    it("scores 3 for scattered subsequence", () => {
      expect(fuzzyScore("bwn", "Bruce Wayne")).toBe(3);
    });
    it("scores 3 when all chars appear in order but not contiguously", () => {
      expect(fuzzyScore("brw", "Bruce Wayne")).toBe(3);
    });
  });

  describe("No match", () => {
    it("returns Infinity when query has characters not in text", () => {
      expect(fuzzyScore("xyz", "Bruce Wayne")).toBe(Infinity);
    });
    it("returns Infinity for empty text with non-empty query", () => {
      expect(fuzzyScore("a", "")).toBe(Infinity);
    });
  });

  describe("Empty query", () => {
    it("returns 0 for empty query (shows everything)", () => {
      expect(fuzzyScore("", "Bruce Wayne")).toBe(0);
    });
  });
});

describe("fuzzyFilter", () => {
  const resources = [
    { id: "r-tyler", name: "Bruce Wayne" },
    { id: "r-pam", name: "Diana Prince" },
    { id: "r-nike", name: "Clark Kent" },
    { id: "r-alex", name: "Barry Allen" },
  ];
  const getText = (r: { name: string }) => r.name;

  it("returns all items for empty query", () => {
    expect(fuzzyFilter(resources, "", getText)).toHaveLength(4);
  });

  it("filters out non-matches", () => {
    const result = fuzzyFilter(resources, "zzz", getText);
    expect(result).toHaveLength(0);
  });

  it("ranks prefix match before subsequence match", () => {
    // "bru" is a tier-0 prefix of "Bruce Wayne"; none of the other seeded names contain a
    // "u" at all, so it's the only match.
    const result = fuzzyFilter(resources, "bru", getText);
    expect(result[0].id).toBe("r-tyler");
  });

  it("ranks a contiguous match before a scattered subsequence match", () => {
    // "ay" is a contiguous substring of "Bruce Wayne" ("Wayne", tier 2). In "Barry Allen" the
    // only "a"/"y" pair in order is the 'a' of "Barry" (index 1) and the 'y' of "Barry" (index
    // 4), with an "rr" between them, so it only matches as a scattered subsequence (tier 3).
    // Neither "Diana Prince" nor "Clark Kent" contains a "y" at all. The contiguous match sorts
    // first.
    const result = fuzzyFilter(resources, "ay", getText);
    expect(result.map((r) => r.id)).toEqual(["r-tyler", "r-alex"]);
  });

  it("sorts tier-0 before tier-1 before tier-3", () => {
    // "barry" → tier 0 (prefix) for Barry Allen. "Bruce Wayne" also starts with 'b' but has
    // no 'a' immediately reachable to complete the subsequence "barry" (the only 'a' is in
    // "Wayne", with no 'r' left after it), so it doesn't match at all; neither do the other
    // two seeded names (no 'b').
    const result = fuzzyFilter(resources, "barry", getText);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("r-alex");
  });

  it("stable tie-break: within same tier, shorter name first then alpha", () => {
    // "b" is a tier-0 prefix for both "Barry Allen" and "Bruce Wayne" — same length (11
    // chars including the space), so the tie breaks alphabetically: "Barry" < "Bruce".
    const result = fuzzyFilter(resources, "b", getText);
    expect(result[0].id).toBe("r-alex");
  });

  it("is case-insensitive in matching", () => {
    expect(fuzzyFilter(resources, "BRUCE", getText)).toHaveLength(1);
    expect(fuzzyFilter(resources, "BRUCE", getText)[0].id).toBe("r-tyler");
  });

  it("finds accented names from an unaccented query", () => {
    const people = [...resources, { id: "r-jose", name: "José Alvarez" }, { id: "r-muller", name: "Greta Müller" }];
    expect(fuzzyFilter(people, "jose", getText).map((person) => person.id)).toEqual(["r-jose"]);
    expect(fuzzyFilter(people, "muller", getText).map((person) => person.id)).toEqual(["r-muller"]);
  });

  it("returns items in original (unsorted) order for an empty or whitespace-only query", () => {
    // The early-return path must hand back `items` untouched, not run them through the tier/
    // length/alpha sort — an empty query short-circuits before scoring even starts.
    expect(fuzzyFilter(resources, "", getText)).toEqual(resources);
    expect(fuzzyFilter(resources, "   ", getText)).toEqual(resources);
  });

  it("trims the query before scoring, so surrounding whitespace does not defeat an exact match", () => {
    // Untrimmed, the leading space would push 'Bruce Wayne' out of every tier (no subsequence
    // match for a leading space char), dropping it from the results entirely.
    const result = fuzzyFilter(resources, " bruce", getText);
    expect(result.map((r) => r.id)).toContain("r-tyler");
  });

  it("sorts strictly by tier first, even when the tie-break would otherwise disagree", () => {
    const items = [
      { id: "t0", name: "alphabetsoup" }, // starts with 'al' -> tier 0, but the LONGER name
      { id: "t2", name: "zzalz" }, // contains 'al' -> tier 2, but the SHORTER name
    ];
    expect(fuzzyFilter(items, "al", (i) => i.name).map((i) => i.id)).toEqual(["t0", "t2"]);
  });

  it("does not skip the tier compare on equal tiers (falls through to the length tie-break)", () => {
    const items = [
      { id: "long", name: "alphabet" }, // tier 0, length 8
      { id: "short", name: "al" }, // tier 0, length 2 — same tier, should sort FIRST (shorter)
    ];
    expect(fuzzyFilter(items, "al", (i) => i.name).map((i) => i.id)).toEqual(["short", "long"]);
  });

  it("breaks a same-tier tie by length even when alpha order disagrees", () => {
    const items = [
      { id: "short", name: "qz" }, // tier 0, length 2, alphabetically AFTER 'qaaaaa'
      { id: "long", name: "qaaaaa" }, // tier 0, length 6
    ];
    // Length wins: shorter ('qz') sorts first, even though 'qz' > 'qaaaaa' alphabetically.
    expect(fuzzyFilter(items, "q", (i) => i.name).map((i) => i.id)).toEqual(["short", "long"]);
  });

  it("breaks a same-tier, same-length tie alphabetically", () => {
    const items = [
      { id: "b", name: "qb" },
      { id: "a", name: "qa" },
    ];
    expect(fuzzyFilter(items, "q", (i) => i.name).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps the same tiers as fuzzyScore even though the query is folded once for the whole pass", () => {
    // fuzzyFilter folds the TRIMMED query a single time and scores against that; fuzzyScore folds
    // per call. The two must agree for every item, including when the query needs both trimming and
    // diacritic folding, or the sort order silently diverges from the documented tiers.
    const items = [
      { name: "José Alvarez" }, // tier 0
      { name: "Bruce José" }, // tier 1 (word-boundary)
      { name: "xjosey" }, // tier 2 (mid-word substring)
      { name: "j o s e" }, // tier 3 (scattered subsequence)
      { name: "Clark Kent" }, // no match
    ];
    const query = "  JOSÉ ";
    const expected = items.filter((i) => fuzzyScore(query.trim(), i.name) < Infinity);
    expect(fuzzyFilter(items, query, (i) => i.name)).toEqual([expected[0], expected[1], expected[2], expected[3]]);
    expect(expected.map((i) => fuzzyScore(query.trim(), i.name))).toEqual([0, 1, 2, 3]);
  });
});
