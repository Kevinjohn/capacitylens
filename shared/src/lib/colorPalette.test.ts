import { describe, it, expect } from "vitest";
import { isPresetColor, snapToPresetColor, FALLBACK_PRESET_COLOR, PRESET_COLORS } from "./colorPalette";

describe("canonical palette", () => {
  it("pins every persisted swatch and its tie-break order", () => {
    expect(PRESET_COLORS.join(",")).toBe(
      "#f5bcbc,#f7caba,#f9d9b8,#f9e6b8,#f9f1b8,#d9f2c0,#c2f0d1,#c0edf2,#bed4f4,#ccc0f2,#e0c2f0,#f4bedd,#d8b397,#eb7272,#ef906e,#f3ae6a,#f3ca6a,#f3e16a,#aee37a,#7edf9e,#7adae3,#76a5e7,#947ae3,#be7edf,#e776b8,#c38c61,#e02727,#e65621,#ed841b,#edae1b,#edd11b,#84d434,#3ace6b,#34c7d4,#2d75da,#5c34d4,#9c3ace,#da2d92,#9e663c,#9c1616,#a13812,#a5590d,#a5780d,#a5910d,#59931f,#248f47,#1f8a93,#1b4f98,#3c1f93,#6b248f,#981b64,#684327",
    );
  });
});

describe("snapToPresetColor", () => {
  it("keeps the exported palette runtime-immutable and aligned with membership checks", () => {
    expect(Object.isFrozen(PRESET_COLORS)).toBe(true);
    expect(() => (PRESET_COLORS as unknown as string[]).push("#000000")).toThrow(TypeError);
    expect(PRESET_COLORS).not.toContain("#000000");
    expect(isPresetColor("#000000")).toBe(false);
  });

  it("passes through a preset colour unchanged", () => {
    expect(snapToPresetColor("#e02727")).toBe("#e02727");
    expect(snapToPresetColor(PRESET_COLORS[10])).toBe(PRESET_COLORS[10]);
  });

  it("normalizes a preset colour with surrounding whitespace / mixed case", () => {
    expect(snapToPresetColor("  #E02727  ")).toBe("#e02727");
  });

  it("maps a non-preset colour to its nearest preset by RGB distance", () => {
    // #7cd9e4 is 2/-1/+1 off PRESET_COLORS[20] (#7adae3), nearer to it (distance 6) than to
    // any other preset (the next-nearest is 51+ away in this palette).
    expect(PRESET_COLORS[20]).toBe("#7adae3");
    expect(snapToPresetColor("#7cd9e4")).toBe("#7adae3");
  });

  it("breaks an exact distance tie by palette order (first minimal-distance preset wins)", () => {
    // #f6c3bb sits exactly midway between PRESET_COLORS[0] (#f5bcbc) and PRESET_COLORS[1]
    // (#f7caba): both distance 51, every other preset much farther (500+). A `<=` instead of
    // `<` in the scan (or scanning in the wrong order) would instead pick index 1.
    expect(PRESET_COLORS[0]).toBe("#f5bcbc");
    expect(PRESET_COLORS[1]).toBe("#f7caba");
    expect(snapToPresetColor("#f6c3bb")).toBe(PRESET_COLORS[0]);
  });

  it("returns the fixed fallback for unparseable input", () => {
    expect(snapToPresetColor("not-a-colour")).toBe(FALLBACK_PRESET_COLOR);
    expect(snapToPresetColor(null)).toBe(FALLBACK_PRESET_COLOR);
    expect(snapToPresetColor(undefined)).toBe(FALLBACK_PRESET_COLOR);
    expect(snapToPresetColor(42)).toBe(FALLBACK_PRESET_COLOR);
    expect(snapToPresetColor("#zzzzzz")).toBe(FALLBACK_PRESET_COLOR);
    expect(snapToPresetColor("#1z2z3z")).toBe(FALLBACK_PRESET_COLOR);
  });
});
