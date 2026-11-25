import { useEffect, useRef } from 'react';
import { hasHourlyLoad } from '@capacitylens/shared/types/entities';
import type { ID } from '@capacitylens/shared/types/entities';
import { resolveSchedulingMode } from '@/store/selectors';
import { useStore } from '@/store/useStore';
import type { ColumnGeometry } from './columnGeometry';
import { buildGesturePreviewGeometry } from './gestureGeometry';
import { readLaneSnapshots } from './gestureLanes';
import type { LaneSnapshot } from './gestureLanes';
import type { BarLayout } from './schedulerModel';
import { useAllocationGestureViewModel } from './useAllocationGestureViewModel';
import type { GestureRuntime } from './useAllocationGestureViewModel';

interface AllocationGestureOptions {
  bar: BarLayout;
  geom: ColumnGeometry;
  indexAtClientX: (clientX: number) => number;
  onEdit?: (id: ID) => void;
}

function watchLaneGeometry(
  lanesRef: React.RefObject<LaneSnapshot[]>,
  lanesDirtyRef: React.RefObject<boolean>,
) {
  let animationFrame = 0;
  const refreshDirtyLanes = () => {
    if (!lanesDirtyRef.current) return;
    lanesRef.current = readLaneSnapshots();
    lanesDirtyRef.current = false;
  };
  const markLanesDirty = () => {
    lanesDirtyRef.current = true;
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      refreshDirtyLanes();
    });
  };
  document.addEventListener('scroll', markLanesDirty, true);
  window.addEventListener('resize', markLanesDirty);
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(markLanesDirty);
  for (const lane of lanesRef.current) resizeObserver?.observe(lane.el);
  return () => {
    document.removeEventListener('scroll', markLanesDirty, true);
    window.removeEventListener('resize', markLanesDirty);
    resizeObserver?.disconnect();
    if (animationFrame) cancelAnimationFrame(animationFrame);
  };
}

function useGestureRuntime(allocationId: ID): GestureRuntime {
  const lanesRef = useRef<LaneSnapshot[]>([]);
  const lanesDirtyRef = useRef(false);
  const dropElementRef = useRef<HTMLElement | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const stopGeometryWatch = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    lanesDirtyRef.current = false;
  };
  const setDropTarget = (element: HTMLElement | null) => {
    if (dropElementRef.current === element) return;
    dropElementRef.current?.removeAttribute('data-droptarget');
    element?.setAttribute('data-droptarget', '');
    dropElementRef.current = element;
  };
  const startGeometryWatch = () => {
    stopGeometryWatch();
    stopWatchRef.current = watchLaneGeometry(lanesRef, lanesDirtyRef);
  };
  useEffect(
    () => () => {
      dropElementRef.current?.removeAttribute('data-droptarget');
      dropElementRef.current = null;
      stopGeometryWatch();
      const store = useStore.getState();
      if (store.draggingAllocationId === allocationId) store.setDraggingAllocation(null);
    },
    [allocationId],
  );
  return { lanesRef, setDropTarget, startGeometryWatch, stopGeometryWatch };
}

/**
 * Coordinates the complete allocation gesture lifecycle, including lane hit-testing,
 * drag pinning, weekend-aware previews, reassignment reconciliation and keyboard parity.
 */
export function useAllocationGesture({
  bar,
  geom: geometry,
  indexAtClientX,
  onEdit,
}: AllocationGestureOptions) {
  const schedulingMode = useStore((state) =>
    resolveSchedulingMode(state.data, state.activeCompanyId),
  );
  const isDays = schedulingMode === 'days';
  const isBlocks = !hasHourlyLoad(schedulingMode);
  const runtime = useGestureRuntime(bar.allocation.id);
  const { preview, onPointerDown, nudge } = useAllocationGestureViewModel(
    { bar, indexAtClientX, isDays, ...(onEdit ? { onEdit } : {}) },
    runtime,
  );

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
