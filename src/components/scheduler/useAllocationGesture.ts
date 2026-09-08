import { carriesHourlyLoad, type ID } from "@capacitylens/shared/types/entities";
import { resolveSchedulingMode } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import type { ColumnGeometry } from "./columnGeometry";
import { buildGesturePreviewGeometry } from "./gestureGeometry";
import type { BarLayout } from "./schedulerModel";
import { useAllocationGestureController } from "./useAllocationGestureController";

interface AllocationGestureOptions {
  bar: BarLayout;
  geom: ColumnGeometry;
  indexAtClientX: (clientX: number) => number;
  onEdit?: (id: ID) => void;
}

/**
 * Coordinates the complete allocation gesture lifecycle, including lane hit-testing,
 * drag pinning, weekend-aware previews, reassignment reconciliation and keyboard parity.
 */
export function useAllocationGesture({ bar, geom: geometry, indexAtClientX, onEdit }: AllocationGestureOptions) {
  const schedulingMode = useStore((state) => resolveSchedulingMode(state.data, state.activeAccountId));
  const isDays = schedulingMode === "days";
  const isBlocks = !carriesHourlyLoad(schedulingMode);
  const { preview, onPointerDown, nudge } = useAllocationGestureController({
    bar,
    indexAtClientX,
    isDays,
    isBlocks,
    ...(onEdit ? { onEdit } : {}),
  });

  const { left, width, translateY } = buildGesturePreviewGeometry(bar, geometry, preview);

  return {
    isBlocks,
    dragging: preview !== null,
    left,
    width,
    translateY,
    onPointerDown,
    nudge,
  };
}
