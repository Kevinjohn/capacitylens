import { describe, expect, it } from "vitest";
import { cleanText, hasDisallowedChars, MAX_NAME_LENGTH } from "./strings";

// Built from numeric code points so the source file stays pure ASCII (no invisible
// or ambiguous literals that would make the test lie about what it checks).
// Party popper emoji.
const PARTY = String.fromCodePoint(0x1f389);
// Pile of poo emoji.
const POO = String.fromCodePoint(0x1f4a9);
// White check mark emoji.
const CHECK = String.fromCodePoint(0x2705);
// Control char.
const NUL = String.fromCodePoint(0x0000);
// Zero-width joiner (format).
const ZWJ = String.fromCodePoint(0x200d);
// Right-to-left override (format).
const RLO = String.fromCodePoint(0x202e);
// Emoji variation selector-16 (Mn).
const VS16 = String.fromCodePoint(0xfe0f);
// Combining enclosing keycap (Me).
const KEYCAP = String.fromCodePoint(0x20e3);
// Combining acute accent (Mn, legitimate).
const ACUTE = String.fromCodePoint(0x0301);
// Unassigned in the supported runtime baseline.
const UNASSIGNED = String.fromCodePoint(0x0378);
// Co.
const PRIVATE_USE = String.fromCodePoint(0xe000);
// Cs.
const LONE_SURROGATE = String.fromCharCode(0xd800);
// Variation-selector supplement.
const VS_SUPPLEMENT = String.fromCodePoint(0xe0100);
// Extended_Pictographic, category Po rather than So.
const DOUBLE_EXCLAMATION = String.fromCodePoint(0x203c);

describe("hasDisallowedChars", () => {
  it("accepts ordinary names incl. accents, CJK and punctuation", () => {
    for (const ok of ["José Müller", "O'Brien & Co", "Ferris, Inc.", "设计部", "Project Lightning 2"]) {
      expect(hasDisallowedChars(ok)).toBe(false);
    }
  });

  it("rejects emoji / pictographs", () => {
    expect(hasDisallowedChars(`Ferris ${PARTY} Co`)).toBe(true);
    expect(hasDisallowedChars(POO)).toBe(true);
    expect(hasDisallowedChars(`done ${CHECK}`)).toBe(true);
  });

  it("rejects flag emoji (regional indicators) and symbol marks", () => {
    // 🇬🇧.
    const FLAG_GB = String.fromCodePoint(0x1f1ec, 0x1f1e7);
    expect(hasDisallowedChars(`from ${FLAG_GB}`)).toBe(true);
    // Trademark sign.
    expect(hasDisallowedChars(`Ferris${String.fromCodePoint(0x2122)}`)).toBe(true);
  });

  it("rejects control and zero-width / format characters", () => {
    expect(hasDisallowedChars(`a${NUL}b`)).toBe(true);
    expect(hasDisallowedChars(`a${ZWJ}b`)).toBe(true);
    expect(hasDisallowedChars(`a${RLO}b`)).toBe(true);
  });

  it("conservatively rejects a code point classified as unassigned", () => {
    expect(/^\p{Cn}$/u.test(UNASSIGNED)).toBe(true);
    expect(hasDisallowedChars(`a${UNASSIGNED}b`)).toBe(true);
    expect(cleanText(`a${UNASSIGNED}b`)).toBe("ab");
  });

  it("independently rejects private-use, surrogate, supplementary variation and pictographic classes", () => {
    for (const disallowed of [PRIVATE_USE, LONE_SURROGATE, VS_SUPPLEMENT, DOUBLE_EXCLAMATION]) {
      expect(hasDisallowedChars(`a${disallowed}b`)).toBe(true);
      expect(cleanText(`a${disallowed}b`)).toBe("ab");
    }
    expect(/^\p{Po}$/u.test(DOUBLE_EXCLAMATION)).toBe(true);
    expect(/^\p{So}$/u.test(DOUBLE_EXCLAMATION)).toBe(false);
  });

  it("rejects keycap emoji and the emoji variation selector (U+FE0F / U+20E3)", () => {
    // "1️⃣" keycap emoji.
    expect(hasDisallowedChars(`1${VS16}${KEYCAP}`)).toBe(true);
    // Lone variation selector.
    expect(hasDisallowedChars(VS16)).toBe(true);
    // Lone enclosing-keycap mark.
    expect(hasDisallowedChars(KEYCAP)).toBe(true);
  });

  it("still accepts a legitimate decomposed accent (does NOT ban Nonspacing_Mark wholesale)", () => {
    // "é" written as e + U+0301.
    expect(hasDisallowedChars(`e${ACUTE}`)).toBe(false);
  });

  it("rejects a newline in single-line mode but allows it in multiline", () => {
    expect(hasDisallowedChars("line1\nline2")).toBe(true);
    expect(hasDisallowedChars("line1\nline2", { multiline: true })).toBe(false);
    expect(hasDisallowedChars(`still ${PARTY} bad`, { multiline: true })).toBe(true);
  });
});

describe("cleanText", () => {
  it("strips emoji and collapses whitespace", () => {
    expect(cleanText(`Ferris  ${PARTY}  Co`)).toBe("Ferris Co");
    expect(cleanText(PARTY)).toBe("");
  });

  it("keeps accented letters untouched", () => {
    expect(cleanText("José Müller")).toBe("José Müller");
  });

  it("keeps newlines only in multiline mode", () => {
    expect(cleanText("a\nb")).toBe("a b");
    expect(cleanText("a\nb", { multiline: true })).toBe("a\nb");
  });

  it("caps length to the max", () => {
    const long = "a".repeat(MAX_NAME_LENGTH + 50);
    expect(cleanText(long).length).toBe(MAX_NAME_LENGTH);
  });

  it("caps astral letters by Unicode code point without splitting them", () => {
    const astralLetter = "𠀀";
    const cleaned = cleanText(astralLetter.repeat(MAX_NAME_LENGTH + 1));
    expect(Array.from(cleaned)).toHaveLength(MAX_NAME_LENGTH);
    expect(cleaned.endsWith(astralLetter)).toBe(true);
  });

  it("strips keycap-emoji parts but keeps the base char, and preserves decomposed accents", () => {
    // Emoji presentation stripped, digit kept.
    expect(cleanText(`1${VS16}${KEYCAP}`)).toBe("1");
    // Legitimate accent retained in canonical NFC form.
    expect(cleanText(`e${ACUTE}`)).toBe("é");
  });

  it("normalizes equivalent text and never truncates through a grapheme", () => {
    expect(cleanText(`Cafe${ACUTE}`)).toBe(cleanText("Café"));
    expect(cleanText(`${"a".repeat(MAX_NAME_LENGTH - 1)}e${ACUTE}tail`)).toBe(`${"a".repeat(MAX_NAME_LENGTH - 1)}é`);

    const twoCodePointGrapheme = `क${String.fromCodePoint(0x093f)}`;
    expect(cleanText(`${"a".repeat(MAX_NAME_LENGTH - 1)}${twoCodePointGrapheme}`)).toBe(
      "a".repeat(MAX_NAME_LENGTH - 1),
    );
  });

  it("keeps a tab as-is (exempt from stripping) rather than dropping it", () => {
    // A tab is a Cc control char and would be caught by DISALLOWED if the '\n'/'\t'
    // exemption in the copy loop were narrowed to just '\n'. It would then be
    // dropped outright instead of kept-then-collapsed-to-a-space.
    expect(cleanText("a\tb")).toBe("a b");
  });

  it("collapses a run of several spaces to exactly one, in multiline mode too", () => {
    // Needs a run of 2+ horizontal-whitespace chars: a regex missing its `+`
    // quantifier replaces each char with a space individually (a no-op run of
    // spaces stays a run), instead of collapsing the whole run to one space.
    expect(cleanText("a   b", { multiline: true })).toBe("a b");
  });

  it("collapses (never deletes) a run of horizontal whitespace in multiline mode", () => {
    expect(cleanText("a   b", { multiline: true })).toContain(" ");
  });

  it("caps 3+ blank lines down to exactly one blank line, not zero", () => {
    // Distinguishes replacing a 3+ newline run with '\n\n' (one blank line kept)
    // from deleting it outright.
    expect(cleanText("a\n\n\n\nb", { multiline: true })).toBe("a\n\nb");
  });

  it("trims trailing whitespace exposed by truncating at the max length", () => {
    // "abc def" cut to 4 chars lands mid-whitespace ("abc "); the final .trim()
    // after slice must clean that up, not leave a trailing space.
    expect(cleanText("abc def", { maxLength: 4 })).toBe("abc");
  });
});
