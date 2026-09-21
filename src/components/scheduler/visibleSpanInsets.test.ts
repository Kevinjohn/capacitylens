import { describe, expect, it } from "vitest";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

describe("buildVisibleSpanInsets", () => {
  it("clamps a horizontal span to the scroll container's visible width", () => {
    const insets = buildVisibleSpanInsets("x", "var(--bar-left)", "var(--bar-width)");

    // Leading: how far the viewport's left edge has passed the span's own left, never negative
    // (a span starting inside the window is not pulled leftwards) and never past the span's end.
    expect(insets.leading).toBe("clamp(0px, calc(var(--sched-scroll-left, 0px) - var(--bar-left)), var(--bar-width))");
    // Trailing: the mirror measured from the viewport's right edge.
    expect(insets.trailing).toBe(
      "clamp(0px, calc(var(--bar-left) + var(--bar-width) - var(--sched-scroll-left, 0px) - var(--sched-visible-width, 100000px)), var(--bar-width))",
    );
  });

  it("clamps a vertical span to the scroll container's visible height", () => {
    const insets = buildVisibleSpanInsets("y", "0px", "var(--band-height)");

    expect(insets.leading).toBe("clamp(0px, calc(var(--sched-scroll-top, 0px) - 0px), var(--band-height))");
    expect(insets.trailing).toBe(
      "clamp(0px, calc(0px + var(--band-height) - var(--sched-scroll-top, 0px) - var(--sched-visible-height, 100000px)), var(--band-height))",
    );
  });

  it("falls back to not clamping at all until the container publishes its geometry", () => {
    const { leading, trailing } = buildVisibleSpanInsets("x", "0px", "100px");

    // Scroll offset defaults to 0 and the viewport to a size no span can exceed, so an overlay
    // rendered before the first measurement covers its whole span rather than collapsing to none.
    expect(leading).toContain("var(--sched-scroll-left, 0px)");
    expect(trailing).toContain("var(--sched-visible-width, 100000px)");
  });
});
