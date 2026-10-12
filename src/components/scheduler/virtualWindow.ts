interface ResolveVirtualWindowInput {
  layout: RowLayout;
  heights: number[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx?: number | undefined;
}

// Pure windowing derives visible indices from row heights and scroll position. The renderer reserves extent between every displayed item because a pinned drag source can form a disjoint extra row. Unexpected math errors must remain visible.

/** First and last row indices to render; `last` is `-1` when empty. */
export interface VirtualWindow {
  first: number;

  last: number;
}

/** Cumulative offsets (prefix sums) of every item + the total. Depends only on
 * heights, so callers memoise it on `heights` and rebuild it only when the row set
 * changes, not on every scroll frame. */
export interface RowLayout {
  tops: number[];
  total: number;
}

function requireRowValue(values: number[], index: number, invariant: string): number {
  const value = values[index];
  if (value === undefined) throw new Error(invariant);
  return value;
}

/** Calculates each row top offset and the total height from row heights. */
export function buildLayout(heights: number[]): RowLayout {
  const tops = Array.from<number>({ length: heights.length });
  let totalHeight = 0;
  for (let index = 0; index < heights.length; index++) {
    const height = requireRowValue(heights, index, "Virtual row heights must be dense.");
    tops[index] = totalHeight;
    totalHeight += height;
  }
  return { tops, total: totalHeight };
}

/** The per-scroll-frame work: given a precomputed layout, find the visible slice.
 * Binary-searches both edges. No O(n) prefix-sum rebuild or row scan. */
export function resolveVirtualWindow({
  layout,
  heights,
  scrollTop,
  viewportHeight,
  overscanPx = 300,
}: ResolveVirtualWindowInput): VirtualWindow {
  const itemCount = heights.length;
  if (itemCount === 0) return { first: 0, last: -1 };
  const { tops, total } = layout;
  if (tops.length !== itemCount) throw new Error("Virtual layout tops must align with row heights.");

  // Without a measured viewport, render all rows rather than hiding content before layout. A fitting list also needs no windowing.
  if (viewportHeight <= 0 || total <= viewportHeight + overscanPx) {
    return { first: 0, last: itemCount - 1 };
  }

  const top = scrollTop - overscanPx;
  const bottom = scrollTop + viewportHeight + overscanPx;

  // Clamp the first realized row to a valid final index when scrolling exceeds content bounds.
  let low = 0;
  let high = itemCount;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const rowTop = requireRowValue(tops, middle, "Virtual layout tops must be dense.");
    const rowHeight = requireRowValue(heights, middle, "Virtual row heights must be dense.");
    if (rowTop + rowHeight <= top) low = middle + 1;
    else high = middle;
  }
  const first = Math.min(low, itemCount - 1);

  // Last row whose top is before the lower edge. Starting after `first` keeps at
  // least that row in the result even when the viewport is beyond the content.
  low = first + 1;
  high = itemCount;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (requireRowValue(tops, middle, "Virtual layout tops must be dense.") < bottom) low = middle + 1;
    else high = middle;
  }
  const last = low - 1;

  return { first, last };
}
