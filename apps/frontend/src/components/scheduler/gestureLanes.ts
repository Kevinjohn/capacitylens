/** Measured lane bounds and resource identity used during pointer hit testing. */
export interface LaneSnapshot {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
}

/** Reads current lane bounds from the rendered scheduler grid. */
export function readLaneSnapshots(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-resource-id]')).map((el) => ({
    id: el.getAttribute('data-resource-id') ?? '',
    el,
    rect: el.getBoundingClientRect(),
  }));
}

/** Finds the measured lane under a pointer coordinate. */
export function resolveLaneAt(
  lanes: LaneSnapshot[],
  clientX: number,
  clientY: number,
): LaneSnapshot | undefined {
  for (const lane of lanes) {
    const { rect } = lane;
    // Vertical lane intervals are half-open so adjacent rows cannot both own their shared edge.
    // The following row includes that coordinate through its `top` comparison.
    if (
      clientY >= rect.top &&
      clientY < rect.bottom &&
      clientX >= rect.left &&
      clientX <= rect.right
    ) {
      return lane;
    }
  }
  return undefined;
}
