import { useEffect, useMemo } from "react";
import { useStore, type SchedulerUI } from "../../store/useStore";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { GroupModel, RowModel } from "./schedulerModel";
import type { schedulerDensity } from "./layout";
import { buildLayout, windowFromLayout } from "./virtualWindow";
import type { useSchedulerViewport } from "./useSchedulerViewport";

/**
 * The week-grid scheduler: the helicopter view of who's busy/free. Two non-obvious
 * mechanisms run here — read this before touching the scroll/render path.
 *
 * **1. Vertical virtualization.** The model (groups → rows) is flattened into one ordered
 * `items` list (group headers + the rows of expanded groups), then each item's height is
 * measured (`heights`), prefix-summed by `buildLayout`, and `windowFromLayout` picks the
 * on-screen slice (`{first, last}`) for the current `scrollTop`/viewport height. Only that slice
 * is in the DOM; the vertical space of every skipped item is RESERVED by an aria-hidden spacer
 * div sized to the gap between consecutive rendered items, so the scrollbar geometry stays
 * correct (drop the spacers and the scroll height collapses, so the thumb and every offset would
 * be wrong). `heights`/`layout` are memoised on the item set, so a scroll frame only runs the
 * cheap edge-scan, not a full re-measure.
 *
 * **2. Drag pinning.** Vertical windowing continues to follow scrolling during a drag so newly
 * visible rows become drop targets. If the source row leaves that window, it is rendered as one
 * additional disjoint item at its real layout offset; this keeps the AllocationBar's document
 * pointer listeners mounted without rendering every intervening row. Horizontal date geometry
 * remains frozen until the gesture ends.
 */
export function useSchedulerGridVirtualization(
  model: GroupModel[],
  ui: SchedulerUI,
  density: ReturnType<typeof schedulerDensity>,
  data: AppData,
  {
    days,
    scrollRef,
    scrollTop,
    timelineHeight,
  }: Pick<ReturnType<typeof useSchedulerViewport>, "days" | "scrollRef" | "scrollTop" | "timelineHeight">,
) {
  const consumeResourceJump = useStore((s) => s.consumeResourceJump);
  const draggingAllocationId = useStore((s) => s.draggingAllocationId);
  // Flatten the visible model into one ordered list of renderable items (group
  // headers + the rows of expanded groups) so the grid can window them vertically:
  // at small scale everything renders; past a viewport's worth, only the on-screen
  // slice is in the DOM (the rest is reserved by top/bottom spacers).
  type Item = { kind: "group"; group: GroupModel } | { kind: "row"; group: GroupModel; row: RowModel };
  const items = useMemo(() => {
    const collapsedKeys = new Set(ui.collapsedGroups);
    const out: Item[] = [];
    for (const group of model) {
      // Every model group is now meaningful and labelled: a discipline, Studio/Supplementary,
      // Unassigned, or External. Keep the same collapse behaviour for synthetic fallback bands.
      out.push({ kind: "group", group });
      if (!collapsedKeys.has(group.key)) for (const row of group.rows) out.push({ kind: "row", group, row });
    }
    return out;
  }, [model, ui.collapsedGroups]);

  // Heights + their prefix-sum depend only on the item set (model/collapse), NOT on
  // scroll — memoise so a scroll frame only runs the cheap edge-scan in windowFromLayout.
  const heights = useMemo(
    () => items.map((it) => (it.kind === "group" ? density.groupHeaderHeight : it.row.rowHeight)),
    [items, density],
  );
  const layout = useMemo(() => buildLayout(heights), [heights]);
  const externalGroupIndex = items.findIndex((item) => item.kind === "group" && item.group.external);
  const trackedGridHeight = externalGroupIndex === -1 ? layout.total : (layout.tops[externalGroupIndex] ?? 0);
  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  const visibleClosures = useMemo(
    () =>
      timelineStart && timelineEnd
        ? data.closures.filter(
            (closure) =>
              closure.startDate <= closure.endDate &&
              closure.endDate >= timelineStart &&
              closure.startDate <= timelineEnd,
          )
        : [],
    [data.closures, timelineEnd, timelineStart],
  );

  // Scroll a specific resource row into view when jumpToResource fires (command
  // palette "jump to person"). Mirrors the recenterToken pattern. Uses layout.tops
  // (prefix-sum of row heights) to find the vertical offset.
  const scrollToResource = ui.scrollToResource;
  useEffect(() => {
    if (!scrollToResource || scrollToResource.consumed || !scrollRef.current) return;
    const idx = items.findIndex((it) => it.kind === "row" && it.row.resource.id === scrollToResource.id);
    if (idx === -1) return;
    const top = layout.tops[idx] ?? 0;
    scrollRef.current.scrollTop = top;
    consumeResourceJump(scrollToResource.token);
  }, [scrollToResource, items, layout, scrollRef, consumeResourceJump]);

  const { first, last } = windowFromLayout(layout, heights, scrollTop, timelineHeight);
  // Memoised because this scan is O(rows × bars) and the grid re-renders every frame while a drag
  // autoscrolls — the dragged row only changes when the item set or the dragged id changes, never
  // per scroll pixel. Same keying discipline as the neighbouring derived values above.
  const draggedItemIndex = useMemo(
    () =>
      draggingAllocationId === null
        ? -1
        : items.findIndex(
            (item) => item.kind === "row" && item.row.bars.some((bar) => bar.allocation.id === draggingAllocationId),
          ),
    [items, draggingAllocationId],
  );
  const renderedIndices = useMemo(() => {
    const indices = Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => first + offset);
    if (draggedItemIndex >= 0 && (draggedItemIndex < first || draggedItemIndex > last)) {
      indices.push(draggedItemIndex);
      indices.sort((a, b) => a - b);
    }
    return indices;
  }, [first, last, draggedItemIndex]);
  return { items, heights, layout, renderedIndices, timelineStart, timelineEnd, visibleClosures, trackedGridHeight };
}
