// Visible overlays clamp to the span/viewport intersection through shared CSS scroll variables, avoiding per-span listeners. Publish timeline-relative coordinates; the frozen resource column is already excluded from visible width.

// Disable clamping until the viewport is measured so overlays do not disappear on first paint.
const UNMEASURED_VIEWPORT = "100000px";

const AXIS_VARIABLES = {
  x: { scroll: "--sched-scroll-left", viewport: "--sched-visible-width" },
  y: { scroll: "--sched-scroll-top", viewport: "--sched-visible-height" },
} as const;

/** Axis used when reading viewport inset variables. */
export type ScrollAxis = keyof typeof AXIS_VARIABLES;

/** Leading and trailing viewport offsets for the realized date span. */
export interface VisibleSpanInsets {
  /** Offset from the span's leading edge to the viewport's, `left` on x, `top` on y. */
  readonly leading: string;
  /** Offset from the span's trailing edge to the viewport's, `right` on x, `bottom` on y. */
  readonly trailing: string;
}

/**
 * Build the leading/trailing inset pair positioning an overlay over a span's visible portion.
 *
 * @param axis  Scroll axis the span is clamped along.
 * @param start CSS length of the span's leading edge in the scroll container's content
 * coordinates for `axis`, usually a `var()` the span sets on itself.
 * @param size  CSS length of the span along `axis`.
 */
export function buildVisibleSpanInsets(axis: ScrollAxis, start: string, size: string): VisibleSpanInsets {
  const { scroll, viewport } = AXIS_VARIABLES[axis];
  const scrolled = `var(${scroll}, 0px)`;
  const visible = `var(${viewport}, ${UNMEASURED_VIEWPORT})`;
  return {
    leading: `clamp(0px, calc(${scrolled} - ${start}), ${size})`,
    trailing: `clamp(0px, calc(${start} + ${size} - ${scrolled} - ${visible}), ${size})`,
  };
}
