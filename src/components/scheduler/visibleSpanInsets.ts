/**
 * CSS insets that keep an overlay inside the part of a span the scroll container can actually show.
 *
 * The scheduler paints its whole timeline into one `overflow-auto` container, so a span — an
 * allocation bar, a company-closure band — routinely starts far outside the visible window. An
 * overlay anchored to the span's own edge scrolls away with it, leaving long-running work
 * unlabelled. Clamping the overlay to the intersection of the span and the viewport keeps it on
 * screen, and does it declaratively: the scroll container publishes its offsets as custom
 * properties (one writer for the whole grid), each span publishes its own start and size, and the
 * browser re-resolves the clamp every frame with no per-span scroll listener.
 *
 * The frozen resource column cancels out on the x axis: the published scroll offset and a bar's
 * own left are both measured from the timeline origin, and the published visible width already
 * excludes the column. A span whose `left` includes the column offset (the closure band) must
 * therefore still publish its timeline-relative start here.
 */

/** Wide enough to disable the clamp; applies only before the scroll container has been measured. */
const UNMEASURED_VIEWPORT = "100000px";

const AXIS_VARIABLES = {
  x: { scroll: "--sched-scroll-left", viewport: "--sched-visible-width" },
  y: { scroll: "--sched-scroll-top", viewport: "--sched-visible-height" },
} as const;

export type ScrollAxis = keyof typeof AXIS_VARIABLES;

export interface VisibleSpanInsets {
  /** Offset from the span's leading edge to the viewport's — `left` on x, `top` on y. */
  readonly leading: string;
  /** Offset from the span's trailing edge to the viewport's — `right` on x, `bottom` on y. */
  readonly trailing: string;
}

/**
 * Build the leading/trailing inset pair positioning an overlay over a span's visible portion.
 *
 * @param axis  Scroll axis the span is clamped along.
 * @param start CSS length of the span's leading edge in the scroll container's content
 *              coordinates for `axis`, usually a `var()` the span sets on itself.
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
