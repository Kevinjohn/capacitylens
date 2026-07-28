// Pure vertical-windowing math for the scheduler grid. Given the ordered heights of
// every renderable item (group headers + resource rows), the scroll offset and the
// viewport height, it returns which slice to render plus the top/bottom spacer heights
// that reserve the off-screen scroll extent. Kept pure (no DOM) so it's deterministic
// and unit-testable at any scale — the windowing path can't be exercised in jsdom
// (clientHeight is 0 there), so the test validates this directly.

export interface VirtualWindow {
  first: number; // first item index to render
  last: number; // last item index to render (inclusive); -1 when empty
  topPad: number; // spacer height above the rendered slice
  bottomPad: number; // spacer height below the rendered slice
}

/** Cumulative offsets (prefix sums) of every item + the total. Depends ONLY on
 *  heights, so callers memoise it on `heights` and rebuild it only when the row set
 *  changes — not on every scroll frame. */
export interface RowLayout {
  tops: number[];
  total: number;
}

export function buildLayout(heights: number[]): RowLayout {
  const tops: number[] = new Array(heights.length);
  let acc = 0;
  for (let i = 0; i < heights.length; i++) {
    tops[i] = acc;
    acc += heights[i];
  }
  return { tops, total: acc };
}

/** The per-scroll-frame work: given a precomputed layout, find the visible slice.
 *  Binary-searches both edges — no O(n) prefix-sum rebuild or row scan. */
export function windowFromLayout(
  layout: RowLayout,
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx = 300,
): VirtualWindow {
  const n = heights.length;
  if (n === 0) return { first: 0, last: -1, topPad: 0, bottomPad: 0 };
  const { tops, total } = layout;

  // No measured viewport (jsdom/SSR) or everything fits in view + overscan → render
  // everything (no windowing), mirroring the FALLBACK_TIMELINE_WIDTH approach.
  if (viewportHeight <= 0 || total <= viewportHeight + overscanPx) {
    return { first: 0, last: n - 1, topPad: 0, bottomPad: 0 };
  }

  const top = scrollTop - overscanPx;
  const bottom = scrollTop + viewportHeight + overscanPx;

  // First row whose bottom is after the upper edge. Clamp to the final row when
  // scrollTop is beyond the content, preserving the existing out-of-range behaviour.
  let low = 0;
  let high = n;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (tops[middle] + heights[middle] <= top) low = middle + 1;
    else high = middle;
  }
  const first = Math.min(low, n - 1);

  // Last row whose top is before the lower edge. Starting after `first` keeps at
  // least that row in the result even when the viewport is beyond the content.
  low = first + 1;
  high = n;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (tops[middle] < bottom) low = middle + 1;
    else high = middle;
  }
  const last = low - 1;

  return { first, last, topPad: tops[first], bottomPad: total - (tops[last] + heights[last]) };
}

/** Convenience composing buildLayout + windowFromLayout (used by tests / one-shot callers). */
export function computeWindow(
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx = 300,
): VirtualWindow {
  return windowFromLayout(buildLayout(heights), heights, scrollTop, viewportHeight, overscanPx);
}
