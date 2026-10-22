import { describe, it, expect } from "vitest";
import { contrastRatio, readableTextColor, ensureBarColors, resolveAccessibleBarColors } from "./accessibleColors";

describe("contrastRatio", () => {
  it("linearises a near-black channel via the low-s division branch, not the gamma curve", () => {
    // s = 1/255 <= 0.03928, so normalizeLinearChannel must take the s/12.92 branch. Using the
    // gamma (pow) branch instead, or multiplying instead of dividing, gives a very
    // different luminance and thus ratio.
    expect(contrastRatio("#010101", "#000000")).toBeCloseTo(1.0060705396709768, 9);
  });

  it("linearises a mid-tone channel via the gamma curve division, not multiplication", () => {
    // s = 128/255 > 0.03928, so this exercises the pow((s+0.055)/1.055, 2.4) branch.
    expect(contrastRatio("#808080", "#ffffff")).toBeCloseTo(3.9494396480491156, 9);
  });

  it("falls back to a ratio of 1 when only one channel of a hex is unparseable", () => {
    // Only the r channel is invalid here, so a mutated some->every (or an emptied
    // array) would miss it and let NaN leak into the luminance math instead of
    // short-circuiting to the documented "no contrast info" fallback of 1.
    expect(contrastRatio("#zz0000", "#123456")).toBe(1);
  });

  it("falls back to a ratio of 1 when the SECOND hex is unparseable", () => {
    // hexA is valid and non-black, so only checking hexA for null (dropping the
    // `|| lb === null` half of the guard) would let a null lb fall through into
    // the luminance arithmetic instead of short-circuiting to 1.
    expect(contrastRatio("#ffffff", "#zzzzzz")).toBe(1);
  });

  it("rejects a non-hex trailing nibble in every colour byte", () => {
    expect(contrastRatio("#1z2z3z", "#ffffff")).toBe(1);
  });
});

describe("readableTextColor", () => {
  it("accounts for the real (non-zero) luminance of DARK_INK, not a zeroed-out fallback", () => {
    // At this exact background luminance, using DARK_INK's true luminance picks
    // white ink; treating it as 0 (e.g. a ?? -> && slip, which returns 0 because
    // the left side is truthy) flips the decision to dark ink.
    expect(readableTextColor("#767676")).toBe("#ffffff");
  });

  it("uses the correct white-luminance numerator (1 + 0.05) when picking ink", () => {
    // At this background luminance, the real numerator picks white ink; the
    // mutated numerator (1 - 0.05) undershoots and flips the decision to dark ink.
    expect(readableTextColor("#7c7c7c")).toBe("#ffffff");
  });

  it("returns the dark-ink guard value directly for an unparseable hex", () => {
    // calculateRelativeLuminance(hex) is null here, so the load-bearing guard must return DARK_INK
    // itself: not fall through into contrastRatio, where both sides would tie at the
    // "no contrast info" value of 1 and hand the answer to white ink instead.
    expect(readableTextColor("#zzzzzz")).toBe("#1c2230");
  });
});

describe("resolveAccessibleBarColors", () => {
  it("darkens (multiplies channels down) when white ink is chosen", () => {
    // Exercises the darken branch body (r/g/b *= 0.92) and the toHex '#' prefix +
    // clamp + zero-pad; a b *= -> b /= slip alone changes the blue channel here.
    expect(ensureBarColors("#6366f1")).toEqual({ bg: "#5b5ede", ink: "#ffffff" });
  });

  it("lightens (moves channels toward 255) when dark ink is chosen, never darkens", () => {
    // Real ink here is DARK_INK, so this must take the else/lighten branch. Forcing
    // `darken` true, or the inner `if (darken)` true, or flipping any of the +=/-=
    // or the (255 - c) to (255 + c) in that branch, all change this exact bg.
    expect(resolveAccessibleBarColors("#3b82f6")).toEqual({ bg: "#5391f7", ink: "#1c2230" });
  });

  it("falls back to the neutral colour when the hex has any unparseable channel", () => {
    expect(resolveAccessibleBarColors("#zz3456")).toEqual({ bg: "#9ca3af", ink: "#1c2230" });
  });

  it("falls back when each colour byte has a valid first nibble followed by junk", () => {
    expect(resolveAccessibleBarColors("#1z2z3z")).toEqual({ bg: "#9ca3af", ink: "#1c2230" });
  });

  it("zero-pads a single-hex-digit channel back to two digits", () => {
    // The adjusted red channel here rounds to 0, i.e. a single hex digit ("0")
    // that must be left-padded to "00"; dropping the padStart pad character
    // would shorten the whole hex string.
    expect(resolveAccessibleBarColors("#0070f8")).toEqual({ bg: "#0067e4", ink: "#ffffff" });
  });

  it("passes an already-AA-compliant colour through verbatim, never entering the nudge loop", () => {
    // Pure black clears 4.5:1 against white ink on the very first contrastWithInk() check
    // (21:1), so the loop body never runs and `nudged` stays false, bg must equal the input
    // hex exactly (the caller's own string), not a toHex() round-trip of the same RGB.
    expect(resolveAccessibleBarColors("#000000")).toEqual({ bg: "#000000", ink: "#ffffff" });
  });
});
