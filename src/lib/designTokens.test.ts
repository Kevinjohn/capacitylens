// App-side design-token guard. The colour math (resolveBarColor / readableTextColor /
// contrastRatio / resolveAccessibleBarColors) is canonical in shared and unit-tested there
// (shared/src/lib/color.test.ts): this file does not re-test it. What lives here is the app's own
// presentation layer: the `--c-*` tokens in src/index.css and the DEFAULT_COLORS palette, measured
// through the shared `contrastRatio` so a token edit that drops below WCAG AA fails the gate.
import { describe, it, expect } from "vitest";
import { contrastRatio, resolveAccessibleBarColors } from "@capacitylens/shared/lib/color";
import { DEFAULT_COLORS, SWATCHES } from "./palette";
import indexCss from "@/index.css?raw";

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
const themeDeclarations = {
  light: lightDeclarations,
  dark: new Map([...lightDeclarations, ...darkDeclarations]),
} satisfies Record<Theme, Map<string, string>>;

function token(theme: Theme, name: string, resolving = new Set<string>()): string {
  const value = themeDeclarations[theme].get(name);
  if (!value) throw new Error(`Missing --${name} in ${theme} theme`);
  const alias = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  if (!alias) return value;
  if (resolving.has(name)) throw new Error(`Circular token alias at --${name}`);
  return token(theme, alias, new Set(resolving).add(name));
}

function chromeTokens(theme: Theme) {
  return {
    sidebar: token(theme, "chrome-sidebar"),
    sidebarInk: token(theme, "chrome-sidebar-ink"),
    sidebarMutedInk: token(theme, "chrome-sidebar-muted-ink"),
    toolbar: token(theme, "chrome-toolbar"),
    toolbarInk: token(theme, "c-ink"),
    filterbar: token(theme, "chrome-filterbar"),
    filterbarInk: token(theme, "chrome-filterbar-ink"),
    canvas: token(theme, "scheduler-canvas"),
    canvasInk: token(theme, "c-faint"),
    header: token(theme, "scheduler-header"),
    headerInk: token(theme, "c-faint"),
    group: token(theme, "scheduler-group"),
    groupInk: token(theme, "c-faint"),
  };
}

function registerChromeDepthTokenScenarios(): void {
  it("defines every chrome and scheduler ground in both themes and leaves shadcn surfaces mapped to --c-*", () => {
    for (const name of [
      "chrome-sidebar",
      "chrome-sidebar-ink",
      "chrome-sidebar-muted-ink",
      "chrome-toolbar",
      "chrome-filterbar",
      "chrome-filterbar-ink",
      "scheduler-canvas",
      "scheduler-header",
      "scheduler-group",
    ]) {
      expect(lightDeclarations.has(name)).toBe(true);
      expect(darkDeclarations.has(name)).toBe(true);
    }
    expect(indexCss).toMatch(/--background:\s*var\(--c-base\)/);
    expect(indexCss).toMatch(/--card:\s*var\(--c-surface\)/);
    expect(indexCss).toMatch(/--muted:\s*var\(--c-base\)/);
  });

  it("orders every light chrome tier from the most distinct sidebar to the clean canvas", () => {
    const { sidebar, toolbar, filterbar, canvas } = chromeTokens("light");
    expect(contrastRatio(sidebar, canvas)).toBeGreaterThan(contrastRatio(toolbar, canvas));
    expect(contrastRatio(toolbar, canvas)).toBeGreaterThan(contrastRatio(filterbar, canvas));
    expect(contrastRatio(filterbar, canvas)).toBeGreaterThan(1);
  });

  it("orders every dark chrome tier below the scheduler canvas and preserves faint-text AA", () => {
    const { sidebar, toolbar, filterbar, canvas, canvasInk } = chromeTokens("dark");
    const black = "#000000";
    expect(contrastRatio(sidebar, black)).toBeLessThan(contrastRatio(toolbar, black));
    expect(contrastRatio(toolbar, black)).toBeLessThan(contrastRatio(filterbar, black));
    expect(contrastRatio(filterbar, black)).toBeLessThan(contrastRatio(canvas, black));
    expect(contrastRatio(canvasInk, canvas)).toBeGreaterThanOrEqual(4.5);
  });
}

function registerChromeDepthPairingScenarios(): void {
  it.each(["light", "dark"] as const)("keeps every %s chrome and scheduler ground paired with AA ink", (theme) => {
    const tokens = chromeTokens(theme);
    const pairs = [
      ["sidebar", tokens.sidebarInk, tokens.sidebar],
      ["sidebar muted", tokens.sidebarMutedInk, tokens.sidebar],
      ["toolbar", tokens.toolbarInk, tokens.toolbar],
      ["filterbar", tokens.filterbarInk, tokens.filterbar],
      ["scheduler canvas", tokens.canvasInk, tokens.canvas],
      ["scheduler header", tokens.headerInk, tokens.header],
      ["scheduler group", tokens.groupInk, tokens.group],
    ] as const;

    for (const [, ink, ground] of pairs) {
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives band controls shared semantic surface inputs without overriding final properties", () => {
    const bandRule = indexCss.match(/\[data-chrome-band\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(bandRule).toMatch(/--background:\s*var\(--chrome-control\)/);
    expect(bandRule).toMatch(/--border:\s*var\(--chrome-control-border\)/);
    expect(bandRule).toMatch(/--input:\s*var\(--chrome-control-border\)/);
    expect(bandRule).toMatch(/--input-background:\s*var\(--chrome-control\)/);
    expect(bandRule).toMatch(/--input-hover-background:\s*var\(--chrome-control-hover\)/);
    expect(bandRule).toMatch(/--outline-background:\s*var\(--chrome-control\)/);
    expect(bandRule).toMatch(/--outline-hover-background:\s*var\(--chrome-control-hover\)/);
    expect(bandRule).not.toMatch(/(?:background|border)-color:/);
  });
}

describe("chrome depth tokens", () => {
  registerChromeDepthTokenScenarios();
  registerChromeDepthPairingScenarios();
});

describe("DEFAULT_COLORS bar legibility (WCAG 1.4.3 AA)", () => {
  it("guarantees the label clears 4.5:1 for every default colour", () => {
    // An app-palette invariant, not a re-test of resolveAccessibleBarColors: retuning a DEFAULT_COLORS entry
    // must not produce a bar whose label the nudge loop cannot rescue to AA.
    for (const hex of Object.values(DEFAULT_COLORS)) {
      const { bg, ink } = resolveAccessibleBarColors(hex);
      expect(contrastRatio(bg, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// These checks read the declarations above directly, so editing a token in index.css changes the
// measured value. Alias resolution also keeps semantic indirection such as --chrome-filterbar-ink
// attached to its source token.
describe("design-token contrast (--c-faint, WCAG 1.4.3 AA)", () => {
  it("clears 4.5:1 on the light canvas AND surface", () => {
    expect(contrastRatio(token("light", "c-faint"), token("light", "c-base"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("light", "c-faint"), token("light", "c-surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the dark-theme faint stays AA on every dark ground", () => {
    for (const ground of ["c-base", "c-surface", "c-elevated"]) {
      expect(contrastRatio(token("dark", "c-faint"), token("dark", ground))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("muted ink token contrast (WCAG 1.4.3 AA)", () => {
  it("keeps the Tailwind muted surface token distinct from muted foreground ink", () => {
    expect(indexCss.match(/--color-muted:/g)).toHaveLength(1);
    expect(indexCss).toMatch(/--color-muted:\s*var\(--muted\)/);
    expect(indexCss).toMatch(
      /\.driver-popover-description,[\s\S]*?\.driver-popover-progress-text\s*\{\s*color:\s*var\(--color-muted-foreground\)/,
    );
    expect(indexCss).toMatch(/\.driver-popover-close-btn\s*\{[^}]*color:\s*var\(--color-muted-foreground\)/);
    expect(indexCss).toMatch(
      /\[data-draw-mode="timeoff"\] \.scheduler-bar[\s\S]*?background-color:\s*var\(--color-muted-foreground\) !important/,
    );
  });

  it.each([
    ["light tour popover", "#5b6472", "#ffffff"],
    ["dark tour popover", "#a3acbd", "#1d212c"],
  ])("keeps muted copy AA on the %s", (_theme, ink, elevated) => {
    expect(contrastRatio(ink, elevated)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("time-off draw-mode treatment", () => {
  const rule = indexCss.match(/\[data-draw-mode="timeoff"\] \.scheduler-timeoff-block\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  it("uses the same vivid yellow and readable dark ink in both themes", () => {
    // Keep the selected treatment in one inherited declaration so theme values cannot drift.
    expect(indexCss.match(/--c-timeoff-selected:\s*#facc15/g)).toHaveLength(1);
    expect(rule).toMatch(/color:\s*var\(--color-timeoff-selected-ink\)/);
  });

  it("keeps the hatch and limits the selected glow", () => {
    expect(rule).toMatch(/background-color:\s*var\(--color-timeoff-selected\) !important/);
    expect(rule).not.toMatch(/(?:^|[;\s])background:\s/);
    expect(rule).toMatch(/0 0 6px 1px/);
  });
});

describe("time-off draw-mode treatment of company closures (#787)", () => {
  const rule = indexCss.match(/\[data-draw-mode="timeoff"\] \.scheduler-closure-band\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  it("highlights the closure band with the same timeoff-selected tokens as personal time off, in work mode's own hook", () => {
    expect(rule).toMatch(/color:\s*var\(--color-timeoff-selected-ink\)/);
    expect(rule).toMatch(/background-color:\s*var\(--color-timeoff-selected\) !important/);
    expect(rule).toMatch(/0 0 6px 1px/);

    expect(indexCss).not.toMatch(/\[data-draw-mode="work"\]\s*\.scheduler-closure-band/);
  });
});

describe("company closure label stacking (#788)", () => {
  const zIndexToken = (name: string) => {
    const value = indexCss.match(new RegExp(`--z-index-${name}:\\s*(\\d+);`))?.[1];
    if (!value) throw new Error(`Missing --z-index-${name}`);
    return Number(value);
  };
  // The grid's own layers are Tailwind classes, not tokens: SchedulerGridGroupHeader's row is
  // `relative z-10` and SchedulerGridHeader's sticky date row is `z-20` (its frozen cell `z-30`).
  // SchedulerGrid.test.tsx pins those classes on the rendered DOM; this pins the token between them.
  const GROUP_HEADER_LAYER = 10;
  const STICKY_HEADER_LAYER = 20;

  it("lifts the closure name above the group-header rows without reaching the sticky chrome", () => {
    const label = zIndexToken("scheduler-closure-label");
    expect(label).toBeGreaterThan(GROUP_HEADER_LAYER);
    expect(label).toBeLessThan(STICKY_HEADER_LAYER);

    expect(label).toBeLessThan(zIndexToken("sticky"));
  });

  it("keeps #787's time-off ink on the name now that it no longer inherits from the band", () => {
    const rule =
      indexCss.match(/\[data-draw-mode="timeoff"\] \.scheduler-closure-label-layer\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(rule).toMatch(/color:\s*var\(--color-timeoff-selected-ink\)/);

    expect(rule).not.toMatch(/background-color|box-shadow/);
  });
});

describe("action and identity token contrast", () => {
  it("keeps the light-theme blue readable on white and the green action fill readable with white ink", () => {
    expect(contrastRatio("#2563eb", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#047857", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#065f46", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the dark-theme blue identity visible on charcoal and the green action fill readable", () => {
    expect(contrastRatio("#60a5fa", "#161922")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#047857", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#065f46", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

// Check every adjacent app surface so the shared focus indicator keeps at least 3:1 contrast in both themes.
describe("global focus outline contrast (WCAG 1.4.11 non-text >=3:1)", () => {
  it("applies the opaque brand outline to tabindex-composed primitives", () => {
    expect(indexCss).toMatch(/\[tabindex\][\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-brand\)/);
  });

  it.each([
    ["light canvas", "#2563eb", "#f4f5f8"],
    ["light surface/popover", "#2563eb", "#ffffff"],
    ["light sidebar chrome", "#2563eb", "#222222"],
    ["dark canvas", "#60a5fa", "#0e1016"],
    ["dark surface/sidebar", "#60a5fa", "#161922"],
    ["dark elevated/popover", "#60a5fa", "#1d212c"],
  ])("keeps the outline visible against the %s", (_name, outline, adjacent) => {
    expect(contrastRatio(outline, adjacent)).toBeGreaterThanOrEqual(3);
  });
});

describe("global border default", () => {
  it("keeps the universal fallback in the base layer so border-colour utilities win", () => {
    expect(indexCss).toMatch(
      /@layer base\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\*,\s*\*::before,\s*\*::after\s*\{\s*border-color:\s*var\(--color-line\);\s*\}\s*\}/,
    );
  });
});

describe("reduced-motion animation reset", () => {
  it("bounds infinite utility animations to one near-instant iteration", () => {
    expect(indexCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*0\.01ms !important;[\s\S]*?animation-iteration-count:\s*1 !important;/,
    );
  });
});

describe("Switch state contrast (WCAG 1.4.11 non-text >=3:1)", () => {
  it("maps the component colours through dedicated semantic tokens", () => {
    expect(indexCss).toMatch(/--color-switch-track:\s*var\(--c-switch-track\)/);
    expect(indexCss).toMatch(/--color-switch-thumb:\s*var\(--c-switch-thumb\)/);
  });

  it.each([
    ["light unchecked", "#858d9b", "#f4f5f8"],
    ["light checked", "#1d4ed8", "#f4f5f8"],
    ["dark unchecked", "#2a2f3c", "#e7eaf0"],
    ["dark checked", "#2563eb", "#e7eaf0"],
  ])("keeps the thumb distinguishable from the %s track", (_state, track, thumb) => {
    expect(contrastRatio(track, thumb)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the light unchecked track distinguishable on a white settings surface", () => {
    expect(contrastRatio("#858d9b", "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

describe("destructive Alert body contrast", () => {
  it.each([
    ["light", "#e11d48", "#ffffff"],
    ["dark", "#fb7185", "#161922"],
  ])("keeps the opaque danger token AA on the %s card surface", (_theme, ink, surface) => {
    expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("danger-soft button hover contrast", () => {
  it("uses an opaque hover token instead of compositing over an unknown surface", () => {
    expect(indexCss).toMatch(/--color-danger-soft-hover:\s*var\(--c-danger-soft-hover\)/);
  });

  it.each([
    ["light", "#be123c", "#f8d5de"],
    ["dark", "#fda4af", "#49252e"],
  ])("keeps danger-soft text AA on the %s hover fill", (_theme, ink, hover) => {
    expect(contrastRatio(ink, hover)).toBeGreaterThanOrEqual(4.5);
  });
});

// Both focus-ring edges touch the surrounding surface. At least one must reach
// 3:1 against every checked light and dark adjacency. Pin token values because
// jsdom cannot resolve the CSS variables used by the rendered indicator.
describe("AllocationBar focus ring (dual-tone, WCAG 1.4.11 non-text ≥3:1)", () => {
  const RING_INK = "#1c2230";
  const RING_HALO = "#ffffff";

  // Backgrounds the focus ring can sit adjacent to, in both themes. The over-cell + weekend hexes are
  // the sRGB resolution of the index.css `color-mix(in oklab, …)` tokens (verified to the rgb values
  // the token comments cite), pinned here because jsdom can't resolve color-mix.
  const ADJACENCIES: Record<string, string> = {
    "over-cell (light)": "#fb9ea1",
    "over-cell (dark)": "#934956",
    "canvas (light) --c-base": "#f4f5f8",
    "canvas (dark) --c-base": "#0e1016",
    "surface (light) --c-surface": "#ffffff",
    "surface (dark) --c-surface": "#161922",

    "weekend (light)": "#eaebed",
    "weekend (dark)": "#22252e",
  };

  // The palest + darkest discipline swatches (read live from the palette, so a palette edit can't make
  // this stale): the extreme grounds an opaque bar fill can be. Palest = highest contrast vs black ink;
  // darkest = highest contrast vs white halo.
  const palest = [...SWATCHES].sort((a, b) => contrastRatio(b, "#000000") - contrastRatio(a, "#000000"))[0];
  const darkest = [...SWATCHES].sort((a, b) => contrastRatio(b, "#ffffff") - contrastRatio(a, "#ffffff"))[0];
  if (!palest || !darkest) throw new Error("Expected discipline swatches");
  ADJACENCIES["palest swatch"] = palest;
  ADJACENCIES["darkest swatch"] = darkest;

  for (const [name, bg] of Object.entries(ADJACENCIES)) {
    it(`at least one ring edge clears 3:1 against ${name} (${bg})`, () => {
      const best = Math.max(contrastRatio(RING_INK, bg), contrastRatio(RING_HALO, bg));
      expect(best).toBeGreaterThanOrEqual(3.0);
    });
  }

  it("the dark edge (not white) is what carries the light over-cell — the old single light halo failed here", () => {
    expect(contrastRatio(RING_HALO, "#fb9ea1")).toBeLessThan(3.0);
    expect(contrastRatio(RING_INK, "#fb9ea1")).toBeGreaterThanOrEqual(3.0);
  });

  it("the light edge (not black) is what carries the dark over-cell", () => {
    expect(contrastRatio(RING_INK, "#934956")).toBeLessThan(3.0);
    expect(contrastRatio(RING_HALO, "#934956")).toBeGreaterThanOrEqual(3.0);
  });
});
