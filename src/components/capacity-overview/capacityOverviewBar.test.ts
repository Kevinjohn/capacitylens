import { describe, expect, it } from "vitest";
import { contrastRatio } from "@capacitylens/shared/lib/color";
import indexCss from "../../index.css?raw";
import { capacityBarFillStyle, computeCapacityBarFill } from "./capacityOverviewBar";

describe("computeCapacityBarFill", () => {
  it("fills green proportionally to free hours when available", () => {
    expect(computeCapacityBarFill({ availableHours: 40, freeHours: 20, overHours: 0 })).toEqual({
      kind: "free",
      fraction: 0.5,
    });
  });

  it("renders no fill when fully booked (no free hours, no overbooking)", () => {
    expect(computeCapacityBarFill({ availableHours: 40, freeHours: 0, overHours: 0 })).toEqual({
      kind: "none",
      fraction: 0,
    });
  });

  it("fills red and caps at 100% when overbooked beyond availability", () => {
    expect(computeCapacityBarFill({ availableHours: 40, freeHours: 0, overHours: 48 })).toEqual({
      kind: "over",
      fraction: 1,
    });
  });

  it("renders no fill when unavailable (0 available hours)", () => {
    expect(computeCapacityBarFill({ availableHours: 0, freeHours: 0, overHours: 0 })).toEqual({
      kind: "none",
      fraction: 0,
    });
  });

  it("proportions a partial first week against that week's own availability", () => {
    // A partial week with 16 available hours (2 days) and 8 free hours is 50% green,
    // not measured against a full 40-hour week.
    expect(computeCapacityBarFill({ availableHours: 16, freeHours: 8, overHours: 0 })).toEqual({
      kind: "free",
      fraction: 0.5,
    });
  });
});

describe("capacityBarFillStyle", () => {
  it("uses the plain faint token for no fill, regardless of context", () => {
    expect(capacityBarFillStyle({ kind: "none", fraction: 0 }, "bar")).toEqual({
      background: "var(--color-faint)",
    });
    expect(capacityBarFillStyle({ kind: "none", fraction: 0 }, "bar-number")).toEqual({
      background: "var(--color-faint)",
    });
  });

  it("uses the saturated, text-free -cell pair (plus the overbooked hatch) in Bar mode", () => {
    expect(capacityBarFillStyle({ kind: "free", fraction: 0.5 }, "bar")).toEqual({
      background: "var(--color-ok-cell)",
    });
    const over = capacityBarFillStyle({ kind: "over", fraction: 1 }, "bar");
    expect(over.background).toContain("repeating-linear-gradient(45deg,");
    expect(over.background).toContain("var(--color-danger-cell)");
  });

  it("uses the AA-paired -soft tokens, WITHOUT the hatch, in Bar & number mode", () => {
    expect(capacityBarFillStyle({ kind: "free", fraction: 0.5 }, "bar-number")).toEqual({
      background: "var(--color-ok-soft)",
    });
    const over = capacityBarFillStyle({ kind: "over", fraction: 1 }, "bar-number");
    expect(over.background).toBe("var(--color-danger-soft)");
    expect(over.background).not.toContain("repeating-linear-gradient");
  });

  it("never hatches a free fill, even in Bar mode", () => {
    const style = capacityBarFillStyle({ kind: "free", fraction: 1 }, "bar");
    expect(style.background).not.toContain("repeating-linear-gradient");
  });
});

// Accessibility guard (WCAG 1.4.3 AA, >=4.5:1 / 1.4.1 Use of Color): reads the ACTUAL tokens from
// src/index.css (not a hardcoded duplicate of the palette) so an edit to any of --c-ink / --c-muted
// / --c-danger-soft-ink / --c-ok-soft-ink, or to the -soft mix percentages, that drops a week-cell
// text colour below AA fails this gate instead of shipping. The saturated -cell pair carries no
// text (bar mode's number is `sr-only`), so it has no AA bound — see the "-cell fills read clearly
// coloured" check below instead, which guards the OTHER failure mode: someone diluting -cell back
// toward invisibility the way DESTRUCTIVE_FILL_MIX_PERCENT (round 1 of this fix) had to.
//
// jsdom cannot resolve `color-mix()`, so it is computed here with a small, spec-conformant
// sRGB<->OKLab implementation (Björn Ottosson's matrices, as used by CSS Color 4 `oklab`
// interpolation). Verified against this codebase's own two existing pinned color-mix results in
// src/index.css: `--c-danger-cell` (light, 50% => ~rgb(251,158,161)) and (dark, 60% =>
// ~rgb(147,73,86)) — both match this implementation exactly (see the sanity check below).
type Theme = "light" | "dark";

function parseDeclarations(selector: string): Map<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = indexCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!block) throw new Error(`Missing ${selector} declaration block`);
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => {
      const name = match[1];
      const value = match[2];
      if (!name || !value) throw new Error(`Malformed declaration in ${selector}`);
      return [name, value.trim()];
    }),
  );
}

const lightDeclarations = parseDeclarations(":root");
const darkDeclarations = parseDeclarations(':root[data-theme="dark"]');
const themeDeclarations: Record<Theme, Map<string, string>> = {
  light: lightDeclarations,
  dark: new Map([...lightDeclarations, ...darkDeclarations]),
};

/** Resolves a token's value, following `var(--x)` aliases; returns other declarations (a literal
 * hex, or a `color-mix(...)` expression) verbatim. */
function token(theme: Theme, name: string, resolving = new Set<string>()): string {
  const value = themeDeclarations[theme].get(name);
  if (!value) throw new Error(`Missing --${name} in ${theme} theme`);
  const alias = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  if (!alias) return value;
  if (resolving.has(name)) throw new Error(`Circular token alias at --${name}`);
  return token(theme, alias, new Set(resolving).add(name));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
}
function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}
function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
/** color-mix(in oklab, colorA pctA%, colorB) */
function mixOklab(colorAHex: string, colorBHex: string, pctA: number): string {
  const t = pctA / 100;
  const a = linearRgbToOklab(...(hexToRgb(colorAHex).map(srgbToLinear) as [number, number, number]));
  const b = linearRgbToOklab(...(hexToRgb(colorBHex).map(srgbToLinear) as [number, number, number]));
  const mixed: [number, number, number] = [
    a[0] * t + b[0] * (1 - t),
    a[1] * t + b[1] * (1 - t),
    a[2] * t + b[2] * (1 - t),
  ];
  const linear = oklabToLinearRgb(...mixed);
  const srgb: [number, number, number] = [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])];
  return rgbToHex(srgb);
}

it("mixOklab reproduces this codebase's own pinned --c-danger-cell results exactly", () => {
  // Sanity check on the mixer itself, not on the Overview fill: these two color-mix results are
  // already documented (as ~rgb comments) beside --c-danger-cell in src/index.css.
  expect(mixOklab("#e11d48", "#ffffff", 50)).toBe("#fb9ea1"); // light: rgb(251,158,161)
  expect(mixOklab("#fb7185", "#0e1016", 60)).toBe("#934956"); // dark: rgb(147,73,86)
});

/** Resolves a `color-mix(in oklab, var(--x) N%, <literal>)` declaration to its computed hex and the
 * N it used, reading N and the base token from the CSS text itself (never a hardcoded duplicate). */
function resolveColorMix(theme: Theme, name: string): { hex: string; percent: number } {
  const raw = token(theme, name);
  const match = raw.match(/^color-mix\(\s*in oklab,\s*var\(--([\w-]+)\)\s*(\d+(?:\.\d+)?)%,\s*([^)]+?)\s*\)$/);
  const baseTokenName = match?.[1];
  const percentText = match?.[2];
  const literalSecond = match?.[3];
  if (!baseTokenName || !percentText || !literalSecond) {
    throw new Error(`Expected a color-mix(in oklab, var(--x) N%, <literal>) for --${name} (${theme}); got: ${raw}`);
  }
  const baseColor = token(theme, baseTokenName);
  const second = literalSecond === "white" ? "#ffffff" : literalSecond;
  return { hex: mixOklab(baseColor, second, Number(percentText)), percent: Number(percentText) };
}

describe.each(["light", "dark"] as const)("Overview bar fill (%s theme)", (theme) => {
  const ink = token(theme, "c-ink");
  const muted = token(theme, "c-muted");
  const dangerSoftInk = token(theme, "c-danger-soft-ink");
  const okSoftInk = token(theme, "c-ok-soft-ink");

  const okSoft = resolveColorMix(theme, "c-ok-soft");
  const dangerSoft = resolveColorMix(theme, "c-danger-soft");
  const okCell = resolveColorMix(theme, "c-ok-cell");
  const dangerCell = resolveColorMix(theme, "c-danger-cell");

  describe("bar-number mode (-soft fills, carries text): WCAG 1.4.3 AA", () => {
    it("keeps the free-days number (--color-ink) AA on the ok-soft fill", () => {
      expect(contrastRatio(ink, okSoft.hex)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps the EmptyCapacity dash (muted-foreground) AA on the ok-soft fill", () => {
      // A fully-booked week can still carry a small free fraction below the rounding threshold,
      // so the dash can render on a free (ok-soft) fill, not only a destructive one.
      expect(contrastRatio(muted, okSoft.hex)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps the free-days number AA on the danger-soft fill (a week can be both free and over)", () => {
      expect(contrastRatio(ink, dangerSoft.hex)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps the EmptyCapacity dash AA on the danger-soft fill", () => {
      expect(contrastRatio(muted, dangerSoft.hex)).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps the overbooked label's switched ink (text-danger-soft-ink) AA on its own fill", () => {
      // The label must NOT use `text-destructive` here: that shares the fill's hue and fails (see
      // git history for round 1's ~2%-mix workaround). --c-danger-soft-ink is the dedicated,
      // deliberately darker/lighter ink this fill is paired with elsewhere in the app already
      // (button.tsx's "danger-soft" variant).
      expect(contrastRatio(dangerSoftInk, dangerSoft.hex)).toBeGreaterThanOrEqual(4.5);
    });

    it("would ALSO clear AA for the free ink counterpart, if ever used the same way", () => {
      expect(contrastRatio(okSoftInk, okSoft.hex)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("bar mode (-cell fills, no text): reads clearly coloured, not diluted for AA", () => {
    // These fills carry NO text (bar mode's number is `sr-only`), so there is no AA bound on them
    // — but round 1 of this fix showed the opposite failure mode is just as real: a fill diluted
    // to clear AA for same-hue text stops reading as its colour at all. Pin a floor on the mix
    // percentage itself so a future "soften this for AA" edit here gets caught, not shipped.
    it("mixes at least 40% of the ok/danger token into the ok-cell/danger-cell fill", () => {
      expect(okCell.percent).toBeGreaterThanOrEqual(40);
      expect(dangerCell.percent).toBeGreaterThanOrEqual(40);
    });

    it("reads as green (ok-cell) and red (danger-cell) by channel dominance, not just luminance", () => {
      // WCAG contrast ratio is a luminance-only measure and cannot tell red from green at similar
      // luminance (a pale rose and a pale sage can measure near-identical contrast against the same
      // ground) — so the "reads as its colour" guarantee is a simple, direct RGB-channel check
      // instead: ok-cell's green channel dominates red, danger-cell's red channel dominates green.
      const [okRed, okGreen] = hexToRgb(okCell.hex);
      const [dangerRed, dangerGreen] = hexToRgb(dangerCell.hex);
      expect(okGreen).toBeGreaterThan(okRed);
      expect(dangerRed).toBeGreaterThan(dangerGreen);
    });
  });
});
