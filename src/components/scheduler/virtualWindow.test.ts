import { describe, it, expect } from "vitest";
import { buildLayout, resolveVirtualWindow } from "./virtualWindow";

interface ComputeWindowTestInput {
  heights: number[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx?: number | undefined;
}

// The one-shot composition SchedulerGrid does NOT do (it memoises the layout across scroll
// frames, so it holds the two calls apart). Production has no use for the pair, so it lives
// here, where every case below wants a window straight from a heights array.
const computeWindow = ({ heights, scrollTop, viewportHeight, overscanPx = 300 }: ComputeWindowTestInput) =>
  resolveVirtualWindow({ layout: buildLayout(heights), heights, scrollTop, viewportHeight, overscanPx });

describe("computeWindow", () => {
  it("rejects sparse heights instead of treating a missing row as zero-height", () => {
    const heights = [20, 20, 20];
    delete heights[1];

    expect(() => buildLayout(heights)).toThrow("row heights must be dense");
  });

  it("rejects a layout that is not aligned with its row heights", () => {
    expect(() =>
      resolveVirtualWindow({
        layout: { tops: [0], total: 60 },
        heights: [20, 20, 20],
        scrollTop: 30,
        viewportHeight: 10,
        overscanPx: 0,
      }),
    ).toThrow("layout tops must align with row heights");
  });

  it("renders everything when the content fits the viewport", () => {
    const heights = Array.from({ length: 8 }, () => 56); // 448px total
    const w = computeWindow({ heights, scrollTop: 0, viewportHeight: 720 });
    expect(w).toEqual({ first: 0, last: 7 });
  });

  it("renders everything when the viewport is unmeasured (jsdom: height 0)", () => {
    const heights = Array.from({ length: 200 }, () => 56);
    const w = computeWindow({ heights, scrollTop: 0, viewportHeight: 0 });
    expect(w).toEqual({ first: 0, last: 199 });
  });

  it("windows a large list to the visible slice (+overscan) at 200 rows", () => {
    const heights = Array.from({ length: 200 }, () => 50); // 10,000px total
    const layout = buildLayout(heights);
    const w = resolveVirtualWindow({ layout, heights, scrollTop: 1000, viewportHeight: 500, overscanPx: 300 });
    // Visible band [700, 1800): rows 14 (ends 750>700) … 35 (top 1750<1800).
    expect(w.first).toBe(14);
    expect(w.last).toBe(35);
    expect(layout.tops[w.first]).toBe(700); // 14 * 50
    // The rendered slice plus the extent reserved either side always sums back to the full
    // scroll height (stable scrollbar) — the property the grid's spacer divs rely on, sized
    // from this same layout.
    const renderedHeight = heights.slice(w.first, w.last + 1).reduce((a, b) => a + b, 0);
    const above = layout.tops[w.first];
    expect(above).toBeDefined();
    const lastTop = layout.tops[w.last];
    const lastHeight = heights[w.last];
    expect(lastTop).toBeDefined();
    expect(lastHeight).toBeDefined();
    if (above === undefined || lastTop === undefined || lastHeight === undefined)
      throw new Error("Expected the resolved virtual window bounds.");
    const below = layout.total - (lastTop + lastHeight);
    expect(above + renderedHeight + below).toBe(10000);
    // Only a small slice is rendered, not all 200.
    expect(w.last - w.first + 1).toBeLessThan(40);
  });
});

describe("computeWindow boundaries", () => {
  it("finds a deep window without scanning all preceding rows", () => {
    const heights = Array.from({ length: 65_536 }, () => 50);
    const layout = buildLayout(heights);
    let offsetReads = 0;
    layout.tops = new Proxy(layout.tops, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) offsetReads++;
        return Reflect.get(target, property, receiver);
      },
    });

    const w = resolveVirtualWindow({ layout, heights, scrollTop: 3_000_000, viewportHeight: 500, overscanPx: 300 });

    expect(w.first).toBe(59_994);
    expect(w.last).toBe(60_015);
    expect(offsetReads).toBeLessThan(100);
  });
  it("clamps at the top of the list", () => {
    const heights = Array.from({ length: 200 }, () => 50);
    const layout = buildLayout(heights);
    const w = resolveVirtualWindow({ layout, heights, scrollTop: 0, viewportHeight: 500, overscanPx: 300 });
    expect(w.first).toBe(0);
    expect(layout.tops[w.first]).toBe(0); // nothing to reserve above the first row
  });

  it("handles variable row heights", () => {
    const heights = [100, 40, 40, 40, 200, 40, 40, 40, 40, 40]; // total 620
    const layout = buildLayout(heights);
    const w = resolveVirtualWindow({ layout, heights, scrollTop: 0, viewportHeight: 200, overscanPx: 0 });
    // band [0,200): items 0(0-100),1(100-140),2(140-180),3(180-220) → last is 3
    expect(w.first).toBe(0);
    expect(w.last).toBe(3);
    const rendered = heights.slice(0, 4).reduce((a, b) => a + b, 0);
    const firstTop = layout.tops[w.first];
    const lastTop = layout.tops[w.last];
    const lastHeight = heights[w.last];
    expect(firstTop).toBeDefined();
    expect(lastTop).toBeDefined();
    expect(lastHeight).toBeDefined();
    if (firstTop === undefined || lastTop === undefined || lastHeight === undefined)
      throw new Error("Expected the resolved virtual window bounds.");
    const below = layout.total - (lastTop + lastHeight);
    expect(firstTop + rendered + below).toBe(620);
  });

  it("is empty for no items", () => {
    expect(computeWindow({ heights: [], scrollTop: 0, viewportHeight: 720 })).toEqual({ first: 0, last: -1 });
  });
});

describe("computeWindow fit and overflow guards", () => {
  // The "everything fits in view + overscan" fast path is independent of scrollTop — it answers
  // "does the WHOLE list fit", not "what's visible from here". A huge scrollTop, fed through the
  // (unmutated) windowing math below it, would legitimately trim rows off the front — proving the
  // fast path is actually short-circuiting the windowing logic, not just producing the same answer.
  it("the fits-in-view fast path renders everything regardless of scrollTop (not a coincidence of scrollTop=0)", () => {
    const heights = Array.from({ length: 7 }, () => 20); // total 140
    // viewportHeight + overscanPx = 150 >= 140 → fits, fast path — even at a huge scrollTop.
    expect(computeWindow({ heights, scrollTop: 200, viewportHeight: 50, overscanPx: 100 })).toEqual({
      first: 0,
      last: 6,
    });
  });

  // Boundary of the fast-path guard: total === viewportHeight + overscanPx exactly must still take
  // the "fits" branch (<=, not <). Below, a nonzero scrollTop proves it — if the guard were a
  // strict '<', it would fall through to windowing and (correctly, using the real overscanPx) trim
  // the first row.
  it("the fits-in-view guard includes the exact-fit boundary (<=), not just strictly-under", () => {
    const heights = [20, 20, 20, 20]; // total 80
    // viewportHeight(80) + overscanPx(0) === total(80) exactly.
    expect(computeWindow({ heights, scrollTop: 30, viewportHeight: 80, overscanPx: 0 })).toEqual({ first: 0, last: 3 });
  });

  // The `first` scan's own bound (`first < n - 1`) must stop it at the LAST valid index — never
  // walk off the end into out-of-range (undefined) heights/tops. A very large `top` (scrollTop far
  // past the content) makes the height-check side of the loop condition stay true all the way to
  // the last row, so only the explicit bound decides where it stops.
  it("the first-scan bound stops it AT the last index, never past it", () => {
    const heights = [10, 10, 10];
    const layout = buildLayout(heights);
    // total 30, well past viewportHeight+overscanPx(10) so the fast path is skipped; a scrollTop of
    // 1000 pushes `top` far beyond every row's bottom edge.
    const w = resolveVirtualWindow({ layout, heights, scrollTop: 1000, viewportHeight: 10, overscanPx: 0 });
    expect(w).toEqual({ first: 2, last: 2 });
    expect(layout.tops[w.first]).toBe(20); // the two rows above are still reserved, not rendered
  });
});
