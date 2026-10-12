import { useEffect, useMemo } from "react";
import { useStore } from "@/store/useStore";
import type { SchedulerUI } from "@/store/useStore";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { GroupModel, RowModel } from "./schedulerModel";
import type { buildSchedulerDensity } from "./layout";
import { buildLayout, resolveVirtualWindow } from "./virtualWindow";
import type { useSchedulerViewport } from "./useSchedulerViewport";

interface UseSchedulerGridVirtualizationInput {
  model: GroupModel[];
  ui: SchedulerUI;
  density: ReturnType<typeof buildSchedulerDensity>;
  data: AppData;
  viewport: Pick<ReturnType<typeof useSchedulerViewport>, "days" | "scrollRef" | "scrollTop" | "timelineHeight">;
}

type Item = { kind: "group"; group: GroupModel } | { kind: "row"; group: GroupModel; row: RowModel };

function flattenVisibleItems(model: GroupModel[], collapsedGroups: readonly string[]): Item[] {
  const collapsedKeys = new Set(collapsedGroups);
  const items: Item[] = [];
  for (const group of model) {
    items.push({ kind: "group", group });
    if (!collapsedKeys.has(group.key)) {
      for (const row of group.rows) items.push({ kind: "row", group, row });
    }
  }
  return items;
}

function resolveTrackedGridHeight(items: Item[], layout: ReturnType<typeof buildLayout>): number {
  const externalGroupIndex = items.findIndex((item) => item.kind === "group" && item.group.external);
  return externalGroupIndex === -1 ? layout.total : (layout.tops[externalGroupIndex] ?? 0);
}

function resolveTimelineBounds(days: readonly string[]) {
  return { timelineStart: days[0], timelineEnd: days[days.length - 1] };
}

/** Derives row and group heights once per model, then renders the viewport slice while reserving skipped space. During drag, a source row outside that slice remains mounted at its layout offset so its pointer listeners survive scrolling; horizontal geometry stays frozen. */
export function useSchedulerGridVirtualization({
  model,
  ui,
  density,
  data,
  viewport: { days, scrollRef, scrollTop, timelineHeight },
}: UseSchedulerGridVirtualizationInput) {
  const consumeResourceJump = useStore((state) => state.consumeResourceJump);
  const draggingAllocationId = useStore((state) => state.draggingAllocationId);

  const items = useMemo(() => flattenVisibleItems(model, ui.collapsedGroups), [model, ui.collapsedGroups]);

  // Heights + their prefix-sum depend only on the item set (model/collapse), not on
  // scroll: memoise so a scroll frame only runs the cheap edge-scan in resolveVirtualWindow.
  const heights = useMemo(
    () => items.map((interval) => (interval.kind === "group" ? density.groupHeaderHeight : interval.row.rowHeight)),
    [items, density],
  );
  const layout = useMemo(() => buildLayout(heights), [heights]);
  const trackedGridHeight = resolveTrackedGridHeight(items, layout);
  const { timelineStart, timelineEnd } = resolveTimelineBounds(days);
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

  const scrollToResource = ui.scrollToResource;
  useEffect(() => {
    if (!scrollToResource || scrollToResource.consumed || !scrollRef.current) return;
    const index = items.findIndex(
      (interval) => interval.kind === "row" && interval.row.resource.id === scrollToResource.id,
    );
    if (index === -1) return;
    const top = layout.tops[index] ?? 0;
    scrollRef.current.scrollTop = top;
    consumeResourceJump(scrollToResource.token);
  }, [scrollToResource, items, layout, scrollRef, consumeResourceJump]);

  const { first, last } = resolveVirtualWindow({ layout, heights, scrollTop, viewportHeight: timelineHeight });
  // Memoised because this scan is O(rows × bars) and the grid re-renders every frame while a drag
  // autoscrolls: the dragged row only changes when the item set or the dragged id changes, never
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
