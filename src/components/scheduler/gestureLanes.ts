import type { AppData, ID } from "@capacitylens/shared/types/entities";
import { resolveSharedActiveData, resolveSharedScopedData } from "../../store/useScopedData";

export interface LaneSnapshot {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
}

export function readLaneSnapshots(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-resource-id]")).map((el) => ({
    id: el.getAttribute("data-resource-id") ?? "",
    el,
    rect: el.getBoundingClientRect(),
  }));
}

export function resolveLaneAt(lanes: LaneSnapshot[], clientX: number, clientY: number): LaneSnapshot | undefined {
  for (const lane of lanes) {
    const { rect } = lane;
    // Vertical lane intervals are half-open so adjacent rows cannot both own their shared edge.
    // The following row includes that coordinate through its `top` comparison.
    if (clientY >= rect.top && clientY < rect.bottom && clientX >= rect.left && clientX <= rect.right) {
      return lane;
    }
  }
  return undefined;
}

// Reuses the hooks' memoised scoping/active-only caches (useScopedData) rather than re-deriving the
// slice: a gesture reads this on every pointer event, and the rendering hooks have already paid for
// the identical projection of the same `data` object.
export function buildActiveGestureData(data: AppData, activeAccountId: ID | null): AppData {
  return resolveSharedActiveData(resolveSharedScopedData(data, activeAccountId));
}
