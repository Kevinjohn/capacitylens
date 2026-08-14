import { describe, it, expect } from "vitest";
import { resolveBarColor, readableTextColor, contrastRatio, ensureBarColors } from "@capacitylens/shared/lib/color";
import { DEFAULT_COLORS, SWATCHES } from "./palette";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import indexCss from "../index.css?raw";

function dataWith(projectColor: string, clientColor = "#client"): AppData {
  return {
    ...emptyAppData(),
    clients: [
      {
        id: "c1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "Acme",
        color: clientColor,
      },
    ],
    projects: [
      {
        id: "p1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "P",
        clientId: "c1",
        color: projectColor,
      },
    ],
    activities: [
      {
        id: "t1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "T",
        kind: "project",
        projectId: "p1",
      },
    ],
    resources: [
      {
        id: "r1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        kind: "person",
        role: "Dev",
        employmentType: "permanent",
        engagement: "studio" as const,
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#resource",
      },
    ],
  };
}

const alloc = {
  id: "a1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  resourceId: "r1",
  activityId: "t1",
  startDate: "2026-06-01",
  endDate: "2026-06-02",
  hoursPerDay: 8,
  status: "confirmed" as const,
};

// resolveBarColor takes id→entity maps (built once by the scheduler model); build them here.
const maps = (d: AppData) => ({
  activities: new Map(d.activities.map((t) => [t.id, t])),
  projects: new Map(d.projects.map((p) => [p.id, p])),
  clients: new Map(d.clients.map((c) => [c.id, c])),
  resources: new Map(d.resources.map((r) => [r.id, r])),
});

describe("resolveBarColor", () => {
  it("prefers the project colour", () => {
    expect(resolveBarColor(alloc, maps(dataWith("#project")))).toBe("#project");
  });

  it("falls back to the client colour when the project has none", () => {
    expect(resolveBarColor(alloc, maps(dataWith("", "#client")))).toBe("#client");
  });

  it("falls back to the resource colour when project and client have none", () => {
    expect(resolveBarColor(alloc, maps(dataWith("", "")))).toBe("#resource");
  });

  it("uses a neutral grey when nothing resolves", () => {
    expect(resolveBarColor(alloc, maps(emptyAppData()))).toBe("#9ca3af");
  });
});

describe("readableTextColor", () => {
  it("uses dark ink on light backgrounds", () => {
    expect(readableTextColor("#ffffff")).toBe("#1c2230");
    expect(readableTextColor("#fbbf24")).toBe("#1c2230"); // amber
  });
  it("uses white on dark/saturated backgrounds", () => {
    expect(readableTextColor("#1c2230")).toBe("#ffffff");
    expect(readableTextColor("#2563eb")).toBe("#ffffff"); // blue
  });
  it("falls back to dark ink for malformed input", () => {
    expect(readableTextColor("#abc")).toBe("#1c2230");
    expect(readableTextColor("not-a-color")).toBe("#1c2230");
  });
});

describe("ensureBarColors", () => {
  it("guarantees the label clears WCAG AA (4.5:1) for every default colour", () => {
    for (const hex of Object.values(DEFAULT_COLORS)) {
      const { bg, ink } = ensureBarColors(hex);
      expect(contrastRatio(bg, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("leaves an already-compliant colour effectively unchanged", () => {
    const { bg, ink } = ensureBarColors("#000000");
    expect(ink).toBe("#ffffff");
    expect(contrastRatio(bg, ink)).toBeGreaterThanOrEqual(4.5);
  });
  it("falls back for malformed input", () => {
    const { bg, ink } = ensureBarColors("nope");
    expect(contrastRatio(bg, ink)).toBeGreaterThan(1);
  });
  it("falls back to neutral grey for an OVERLONG hex (was mis-sliced before)", () => {
    expect(ensureBarColors("#aabbccdd").bg).toBe("#9ca3af"); // 8 digits → invalid → grey, not a wrong colour
  });
});

// Design-token contrast guard. The hex values mirror the `--c-*` tokens in src/index.css; CSS
// custom properties aren't resolvable in jsdom, so we pin the values here and FAIL the gate if the
// token is edited below AA without updating its inline ratio comment. --c-faint was 4.43:1 on the
// canvas (sub-AA) and is darkened to #677080 to clear 4.5:1 on BOTH the canvas and the white surface
// (WCAG 1.4.3 / SC 1.4.3, normal small text). See the token comment in src/index.css.
describe("design-token contrast (--c-faint, WCAG 1.4.3 AA)", () => {
  const FAINT_LIGHT = "#677080";
  const CANVAS_LIGHT = "#f4f5f8"; // --c-base
  const SURFACE_LIGHT = "#ffffff"; // --c-surface (= --c-elevated)
  const FAINT_DARK = "#8b93a3";
  const CANVAS_DARK = "#0e1016";
  const SURFACE_DARK = "#161922";
  const ELEVATED_DARK = "#1d212c";

  it("clears 4.5:1 on the light canvas AND surface", () => {
    expect(contrastRatio(FAINT_LIGHT, CANVAS_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FAINT_LIGHT, SURFACE_LIGHT)).toBeGreaterThanOrEqual(4.5);
  });

  it("the dark-theme faint stays AA on every dark ground", () => {
    expect(contrastRatio(FAINT_DARK, CANVAS_DARK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FAINT_DARK, SURFACE_DARK)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(FAINT_DARK, ELEVATED_DARK)).toBeGreaterThanOrEqual(4.5);
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
    // The dark theme inherits this single root declaration: a second theme-specific value would
    // allow the selected treatment to drift apart again.
    expect(indexCss.match(/--c-timeoff-selected:\s*#facc15/g)).toHaveLength(1);
    expect(rule).toMatch(/color:\s*var\(--color-timeoff-selected-ink\)/);
  });

  it("keeps the hatch and limits the selected glow", () => {
    expect(rule).toMatch(/background-color:\s*var\(--color-timeoff-selected\) !important/);
    expect(rule).not.toMatch(/(?:^|[;\s])background:\s/);
    expect(rule).toMatch(/0 0 6px 1px/);
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

// The global :focus-visible rule uses opaque brand blue for native controls and composed
// `[tabindex]` primitives alike. These are every normal adjacent app surface in both themes;
// sidebar maps to surface and its hover/active ground maps to canvas. Pinning the pairs here makes
// a future token edit fail before it can turn the shared focus indicator sub-3:1 again.
describe("global focus outline contrast (WCAG 1.4.11 non-text >=3:1)", () => {
  it("applies the opaque brand outline to tabindex-composed primitives", () => {
    expect(indexCss).toMatch(/\[tabindex\][\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-brand\)/);
  });

  it.each([
    ["light canvas", "#2563eb", "#f4f5f8"],
    ["light surface/sidebar/popover", "#2563eb", "#ffffff"],
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
      /@layer base\s*\{\s*\/\* Default border colour for the bare `border` utility\. \*\/\s*\*,\s*\*::before,\s*\*::after\s*\{\s*border-color:\s*var\(--color-line\);\s*\}\s*\}/,
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
    ["light", "#e11d48", "#ffffff"], // --c-danger on --c-surface
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

// AllocationBar focus indicator — the dual-tone ring (WCAG 1.4.11, Non-text Contrast ≥3:1). The two
// ring colours below mirror --c-focus-ink / --c-focus-halo in src/index.css (jsdom can't resolve CSS
// vars, so pin them here and FAIL the gate if the CSS changes without updating these). The ring is a
// near-BLACK edge + a near-WHITE edge straddling the bar's outer border, BOTH adjacent to whatever is
// behind the bar. The conformance claim: against EVERY adjacency, in BOTH themes, AT LEAST ONE of the
// two edges clears 3:1 — so the indicator never disappears, including on the over-capacity cell red.
//
// This guard FAILS the prior single-halo approach: that used ONE light edge (white in light / near-
// white #e7eaf0 in dark). On the LIGHT over-cell rose (#fb9ea1) white reads only ~2.0:1, so a
// single-light-edge max would be <3 and this assertion would fail; the dark edge (#1c2230) rescues it
// at ~7.95:1. (The brand blue outline, kept as an identity layer, is NOT counted here.)
describe("AllocationBar focus ring (dual-tone, WCAG 1.4.11 non-text ≥3:1)", () => {
  const RING_INK = "#1c2230"; // --c-focus-ink (near-black edge — wins on pale grounds)
  const RING_HALO = "#ffffff"; // --c-focus-halo (near-white edge — wins on dark grounds)

  // Backgrounds the focus ring can sit adjacent to, in BOTH themes. The over-cell + weekend hexes are
  // the sRGB resolution of the index.css `color-mix(in oklab, …)` tokens (verified to the rgb values
  // the token comments cite), pinned here because jsdom can't resolve color-mix.
  const ADJACENCIES: Record<string, string> = {
    // --c-danger-cell: light = color-mix(in oklab, #e11d48 50%, white); dark = color-mix(#fb7185 60%, #0e1016)
    "over-cell (light)": "#fb9ea1", // ≈ rgb(251,158,161) — pale rose: white reads ~2:1, the DARK edge wins
    "over-cell (dark)": "#934956", //  ≈ rgb(147,73,86)  — deep red:  the LIGHT edge wins
    "canvas (light) --c-base": "#f4f5f8",
    "canvas (dark) --c-base": "#0e1016",
    "surface (light) --c-surface": "#ffffff",
    "surface (dark) --c-surface": "#161922",
    // --c-weekend: light = color-mix(#1c2230 8%, #ffffff); dark = color-mix(#e7eaf0 7%, #161922)
    "weekend (light)": "#eaebed",
    "weekend (dark)": "#22252e",
  };

  // The palest + darkest discipline swatches (read live from the palette, so a palette edit can't make
  // this stale): the extreme grounds an opaque bar fill can be. Palest = highest contrast vs black ink;
  // darkest = highest contrast vs white halo.
  const palest = [...SWATCHES].sort((a, b) => contrastRatio(b, "#000000") - contrastRatio(a, "#000000"))[0];
  const darkest = [...SWATCHES].sort((a, b) => contrastRatio(b, "#ffffff") - contrastRatio(a, "#ffffff"))[0];
  ADJACENCIES["palest swatch"] = palest;
  ADJACENCIES["darkest swatch"] = darkest;

  for (const [name, bg] of Object.entries(ADJACENCIES)) {
    it(`at least one ring edge clears 3:1 against ${name} (${bg})`, () => {
      const best = Math.max(contrastRatio(RING_INK, bg), contrastRatio(RING_HALO, bg));
      expect(best).toBeGreaterThanOrEqual(3.0);
    });
  }

  it("the dark edge (not white) is what carries the light over-cell — the old single light halo failed here", () => {
    // White-only (the retired single-halo approach) is sub-3 on the pale light over-cell; the pairing rescues it.
    expect(contrastRatio(RING_HALO, "#fb9ea1")).toBeLessThan(3.0);
    expect(contrastRatio(RING_INK, "#fb9ea1")).toBeGreaterThanOrEqual(3.0);
  });

  it("the light edge (not black) is what carries the dark over-cell", () => {
    expect(contrastRatio(RING_INK, "#934956")).toBeLessThan(3.0);
    expect(contrastRatio(RING_HALO, "#934956")).toBeGreaterThanOrEqual(3.0);
  });
});

describe("contrastRatio", () => {
  it("black on white is the maximum ~21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThan(20);
  });
  it("identical colours are 1:1", () => {
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
  });
  it("returns 1 for malformed input", () => {
    expect(contrastRatio("nope", "#ffffff")).toBe(1);
  });
  it("returns 1 for an overlong hex", () => {
    expect(contrastRatio("#aabbccdd", "#ffffff")).toBe(1);
  });
});
