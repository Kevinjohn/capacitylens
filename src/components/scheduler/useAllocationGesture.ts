import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { m } from "@/i18n";
import { undoShortcut } from "../../lib/keyboardShortcuts";
import { errorMessage } from "../../lib/errorMessage";
import { applyGesture, type DateRange, type DragMode } from "../../lib/gestureMath";
import {
  capacityAdvisory,
  capacityAllocationsForMode,
  capacityForWindow,
  formatCapacityAdvisory,
} from "../../lib/capacity";
import { rangesOverlap } from "@capacitylens/shared/lib/dateMath";
import { blockHoursPerDay } from "@capacitylens/shared/lib/schedulingDays";
import {
  carriesHourlyLoad,
  FULL_DAY_HOURS,
  isCapacityTracked,
  MAX_HOURS_PER_DAY,
} from "@capacitylens/shared/types/entities";
import type { AppData, ID, Weekday } from "@capacitylens/shared/types/entities";
import { useDragResize } from "../../hooks/useDragResize";
import { resourceDisplayName } from "../../lib/metadata";
import { accountWorkingDaysFor, schedulingModeFor, visibleRange } from "../../store/selectors";
import { sharedActiveData, sharedScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { computeGesture, reconcileReassignedHours, volumePreservingHoursClamped } from "./allocationDrag";
import type { ColumnGeometry } from "./columnGeometry";
import { effectiveWorkingDays, isAllocationMoveStartBlocked } from "./creationAvailability";
import type { BarLayout } from "./schedulerModel";

interface LaneSnapshot {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
}

interface GesturePreview {
  mode: DragMode;
  deltaDays: number;
  deltaY: number;
  targetResourceId: ID | null;
  // The snapped range this frame resolves to, computed ONCE where the pointer is handled. The
  // render body only turns it into pixels; it used to re-derive the target's working week from
  // the store and re-run the gesture math on every frame just to place the bar. `null` when the
  // gesture moves nothing (a resize with no column change), where the bar keeps bar.x / bar.width.
  dates: DateRange | null;
}

function snapshotLanes(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-resource-id]")).map((el) => ({
    id: el.getAttribute("data-resource-id") ?? "",
    el,
    rect: el.getBoundingClientRect(),
  }));
}

function laneAt(lanes: LaneSnapshot[], clientX: number, clientY: number): LaneSnapshot | null {
  for (const lane of lanes) {
    const { rect } = lane;
    // Vertical lane intervals are half-open so adjacent rows cannot both own their shared edge.
    // The following row includes that coordinate through its `top` comparison.
    if (clientY >= rect.top && clientY < rect.bottom && clientX >= rect.left && clientX <= rect.right) {
      return lane;
    }
  }
  return null;
}

// Reuses the hooks' memoised scoping/active-only caches (useScopedData) rather than re-deriving the
// slice: a gesture reads this on every pointer event, and the rendering hooks have already paid for
// the identical projection of the same `data` object.
function activeGestureData(data: AppData, activeAccountId: ID | null): AppData {
  return sharedActiveData(sharedScopedData(data, activeAccountId));
}

/** Builds the screen-reader status from the same visible-range capacity signal as the grid. */
function capacityAnnouncement(resourceId: ID): string {
  const { data: storedData, ui, activeAccountId } = useStore.getState();
  const data = activeGestureData(storedData, activeAccountId);
  const resource = data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource || !isCapacityTracked(resource)) return "";

  const name = resourceDisplayName(resource);
  const blocksMode = !carriesHourlyLoad(schedulingModeFor(storedData, activeAccountId));
  const allocations = capacityAllocationsForMode(
    data.allocations.filter((allocation) => allocation.resourceId === resourceId),
    blocksMode,
  );
  if (allocations.length === 0) return m.scheduler_sr_announce_clear({ name });

  let start = allocations[0]!.startDate;
  let end = allocations[0]!.endDate;
  for (const allocation of allocations) {
    if (allocation.startDate < start) start = allocation.startDate;
    if (allocation.endDate > end) end = allocation.endDate;
  }
  const visible = visibleRange(ui);
  if (start < visible.start) start = visible.start;
  if (end > visible.end) end = visible.end;
  if (start > end) return m.scheduler_sr_announce_clear({ name });

  const timeOff = data.timeOff.filter((entry) => entry.resourceId === resourceId);
  const overDays = capacityForWindow(resource, allocations, timeOff, start, end).filter((day) => day.over).length;
  if (overDays === 0) return m.scheduler_sr_announce_clear({ name });
  return overDays === 1
    ? m.scheduler_sr_announce_over_one({ name, count: overDays })
    : m.scheduler_sr_announce_over_other({ name, count: overDays });
}

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
export function useAllocationGesture({ bar, geom, indexAtClientX, onEdit }: AllocationGestureOptions) {
  // Store WRITES are read at call time instead of subscribed to. Action identities never change, so
  // a `useStore(s => s.action)` selector could only ever re-run for nothing — and it ran once per
  // action, per bar, on every store write. Every gesture handler below is already imperative and
  // already reaches for `useStore.getState()` for the live data it commits against.
  const setDraggingAllocation = (id: ID | null) => useStore.getState().setDraggingAllocation(id);
  const resourceId = bar.allocation.resourceId;
  const schedulingMode = useStore((state) => schedulingModeFor(state.data, state.activeAccountId));
  const isDays = schedulingMode === "days";
  const isBlocks = !carriesHourlyLoad(schedulingMode);
  const [preview, setPreview] = useState<GesturePreview | null>(null);
  const lanesRef = useRef<LaneSnapshot[]>([]);
  const lanesDirtyRef = useRef(false);
  const dropElRef = useRef<HTMLElement | null>(null);
  const geometryWatchRef = useRef<(() => void) | null>(null);
  // Per-gesture memo of the derived working week, keyed by resource. The preview arm resolves this
  // on EVERY pointer frame (store read + resource lookup + a Set-and-filter per call, twice over
  // for a cross-lane drag); a working-week edit cannot land mid-gesture, so one derivation per
  // resource per gesture is exact. Cleared when a gesture arms AND when it ends, so the commit path
  // and the keyboard nudge always re-derive against the live store.
  const gestureWorkingDaysRef = useRef(new Map<ID, Weekday[] | undefined>());

  const workingDaysFor = (targetResourceId: ID) => {
    const state = useStore.getState();
    const resource = state.data.resources.find((candidate) => candidate.id === targetResourceId);
    if (!resource) return undefined;
    return effectiveWorkingDays(resource, accountWorkingDaysFor(state.data, state.activeAccountId));
  };

  const previewWorkingDaysFor = (targetResourceId: ID) => {
    const memo = gestureWorkingDaysRef.current;
    if (memo.has(targetResourceId)) return memo.get(targetResourceId);
    const resolved = workingDaysFor(targetResourceId);
    memo.set(targetResourceId, resolved);
    return resolved;
  };

  const setDropTarget = (el: HTMLElement | null) => {
    if (dropElRef.current === el) return;
    dropElRef.current?.removeAttribute("data-droptarget");
    el?.setAttribute("data-droptarget", "");
    dropElRef.current = el;
  };

  const stopGeometryWatch = () => {
    geometryWatchRef.current?.();
    geometryWatchRef.current = null;
    lanesDirtyRef.current = false;
    gestureWorkingDaysRef.current.clear();
  };

  const refreshDirtyLanes = () => {
    if (!lanesDirtyRef.current) return;
    lanesRef.current = snapshotLanes();
    lanesDirtyRef.current = false;
  };

  const startGeometryWatch = () => {
    stopGeometryWatch();
    let raf = 0;
    const onGeometryChange = () => {
      lanesDirtyRef.current = true;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        refreshDirtyLanes();
      });
    };
    document.addEventListener("scroll", onGeometryChange, true);
    window.addEventListener("resize", onGeometryChange);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onGeometryChange);
    for (const lane of lanesRef.current) resizeObserver?.observe(lane.el);
    geometryWatchRef.current = () => {
      document.removeEventListener("scroll", onGeometryChange, true);
      window.removeEventListener("resize", onGeometryChange);
      resizeObserver?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  };

  useEffect(
    () => () => {
      dropElRef.current?.removeAttribute("data-droptarget");
      dropElRef.current = null;
      stopGeometryWatch();
      const store = useStore.getState();
      if (store.draggingAllocationId === bar.allocation.id) store.setDraggingAllocation(null);
    },
    [bar.allocation.id],
  );

  const { onPointerDown: armPointerGesture } = useDragResize({
    indexAtClientX,
    onPreview: (mode, deltaDays, deltaY, pointer) => {
      if (!preview) setDraggingAllocation(bar.allocation.id);
      const target = mode === "move" ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null;
      const destination = target && target.id !== resourceId ? target : null;
      // Snap ONCE per frame, against the lane the pointer is actually over — the drop-target gate
      // below and the bar's own preview pixels then read the same range instead of each deriving it.
      // A zero-column resize moves nothing, so it keeps the view-model's placement (dates: null).
      const dates =
        deltaDays !== 0 || mode === "move"
          ? applyGesture(mode, { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }, deltaDays, {
              workingDays: previewWorkingDaysFor(destination?.id ?? resourceId),
              ignoreWeekends: bar.allocation.ignoreWeekends,
            })
          : null;
      setPreview({
        mode,
        deltaDays,
        deltaY,
        targetResourceId: target?.id ?? null,
        dates,
      });
      if (mode === "move") {
        const state = useStore.getState();
        const targetResource = destination
          ? state.data.resources.find((candidate) => candidate.id === destination.id)
          : undefined;
        const blocked =
          !!targetResource &&
          !!dates &&
          isAllocationMoveStartBlocked(
            targetResource,
            dates.startDate,
            accountWorkingDaysFor(state.data, state.activeAccountId),
            bar.allocation.ignoreWeekends,
          );
        setDropTarget(destination && !blocked ? destination.el : null);
      }
    },
    onClick: () => {
      stopGeometryWatch();
      setDraggingAllocation(null);
      onEdit?.(bar.allocation.id);
    },
    onCancel: () => {
      stopGeometryWatch();
      setDraggingAllocation(null);
      setPreview(null);
      setDropTarget(null);
    },
    onCommit: (mode, deltaDays, pointer) => {
      // The final hit test is authoritative. Re-read move-lane geometry even if a scroll/resize
      // observer callback has not run yet, then stop its queued preview refresh.
      if (mode === "move") lanesRef.current = snapshotLanes();
      const { setNotice, updateAllocation } = useStore.getState();
      stopGeometryWatch();
      setPreview(null);
      setDraggingAllocation(null);
      const current = {
        startDate: bar.allocation.startDate,
        endDate: bar.allocation.endDate,
      };
      const target = mode === "move" ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null;
      const reassignTo = target && target.id !== resourceId ? target.id : null;
      setDropTarget(null);
      if (deltaDays === 0 && !reassignTo) return;

      const computeFor = (targetResourceId: ID) => {
        return computeGesture(
          mode,
          current,
          deltaDays,
          {
            workingDays: workingDaysFor(targetResourceId),
            ignoreWeekends: bar.allocation.ignoreWeekends,
          },
          bar.allocation.hoursPerDay,
          isDays,
        );
      };

      const effectiveResourceId = reassignTo ?? resourceId;
      const { dates, hours, clamped } = computeFor(effectiveResourceId);
      const state = useStore.getState();
      const effectiveResource = state.data.resources.find((resource) => resource.id === effectiveResourceId);
      const targetResource = reassignTo
        ? state.data.resources.find((resource) => resource.id === reassignTo)
        : undefined;
      if (effectiveResource && (mode === "move" || dates.startDate !== current.startDate)) {
        if (
          isAllocationMoveStartBlocked(
            effectiveResource,
            dates.startDate,
            accountWorkingDaysFor(state.data, state.activeAccountId),
            bar.allocation.ignoreWeekends,
          )
        ) {
          setNotice(m.scheduler_toast_non_working_drop(), "error");
          return;
        }
      }
      const reconciledHours = targetResource
        ? reconcileReassignedHours(hours, targetResource, isBlocks, dates.startDate)
        : hours;
      const hoursPatch = reconciledHours !== bar.allocation.hoursPerDay ? { hoursPerDay: reconciledHours } : null;

      let updated: boolean;
      try {
        updated = updateAllocation(bar.allocation.id, {
          ...dates,
          ...hoursPatch,
          ...(reassignTo ? { resourceId: reassignTo } : {}),
        });
      } catch (error) {
        // A diagonal drag is one transaction. updateAllocation validates the complete merged row
        // before mutating, so a rejected reassignment leaves the source allocation untouched; do
        // not silently commit its horizontal component as a second, unrelated update.
        setNotice(error instanceof Error ? errorMessage(error) : m.scheduler_toast_move_rejected(), "error");
        return;
      }
      if (!updated) return;

      // The mutation is committed above. Keep pure advisory/feedback work outside its catch so a
      // programmer error cannot be mislabeled as a rejected move or trigger mutation recovery.
      const { data: storedData, activeAccountId } = useStore.getState();
      const data = activeGestureData(storedData, activeAccountId);
      const resource = data.resources.find((candidate) => candidate.id === effectiveResourceId);
      let advisory = "";
      if (resource && isCapacityTracked(resource)) {
        const others = capacityAllocationsForMode(
          data.allocations.filter(
            (allocation) => allocation.resourceId === effectiveResourceId && allocation.id !== bar.allocation.id,
          ),
          isBlocks,
        );
        const timeOff = data.timeOff.filter((entry) => entry.resourceId === effectiveResourceId);
        const result = capacityAdvisory(
          resource,
          {
            resourceId: effectiveResourceId,
            startDate: dates.startDate,
            endDate: dates.endDate,
            // Blocks carry placement but no hourly load — read that load from the ONE knob
            // (`blockHoursPerDay`) rather than hardcoding its current 0, exactly as the grid's
            // own `capacityAllocationsForMode` projection does.
            hoursPerDay: isBlocks ? blockHoursPerDay(FULL_DAY_HOURS) : reconciledHours,
            ignoreWeekends: bar.allocation.ignoreWeekends,
          },
          others,
          timeOff,
        );
        advisory = formatCapacityAdvisory(result, "toast");
      }
      const cap = clamped ? m.scheduler_cap_fragment({ max: MAX_HOURS_PER_DAY }) : "";
      setNotice(
        `${reassignTo ? m.scheduler_toast_reassigned() : m.scheduler_toast_moved()}${advisory}.${cap}${m.scheduler_toast_undo_hint({ shortcut: undoShortcut() })}`,
        clamped ? "warning" : "info",
      );
    },
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!armPointerGesture(event)) return;
    lanesRef.current = snapshotLanes();
    startGeometryWatch();
  };

  const nudge = (mode: DragMode, delta: number) => {
    const { setNotice, updateAllocation, announceCapacity } = useStore.getState();
    const options = {
      workingDays: workingDaysFor(resourceId),
      ignoreWeekends: bar.allocation.ignoreWeekends,
    };
    const current = {
      startDate: bar.allocation.startDate,
      endDate: bar.allocation.endDate,
    };
    const next = applyGesture(mode, current, delta, options);
    if (next.endDate < next.startDate) return;
    const state = useStore.getState();
    const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
    if (
      (mode === "move" || next.startDate !== current.startDate) &&
      resource &&
      isAllocationMoveStartBlocked(
        resource,
        next.startDate,
        accountWorkingDaysFor(state.data, state.activeAccountId),
        bar.allocation.ignoreWeekends,
      )
    ) {
      setNotice(m.scheduler_toast_non_working_drop(), "error");
      return;
    }
    const visible = visibleRange(useStore.getState().ui);
    const currentIntersectsTimeline = rangesOverlap(current.startDate, current.endDate, visible.start, visible.end);
    const nextIntersectsTimeline = rangesOverlap(next.startDate, next.endDate, visible.start, visible.end);
    if (currentIntersectsTimeline && !nextIntersectsTimeline) {
      setNotice(m.scheduler_keyboard_outside_timeline(), "error");
      return;
    }
    const rescale =
      isDays && mode !== "move"
        ? volumePreservingHoursClamped(current, next, options, bar.allocation.hoursPerDay)
        : null;
    if (
      next.startDate === current.startDate &&
      next.endDate === current.endDate &&
      (rescale === null || rescale.hours === bar.allocation.hoursPerDay)
    )
      return;
    try {
      const updated = updateAllocation(bar.allocation.id, {
        ...next,
        ...(rescale ? { hoursPerDay: rescale.hours } : null),
      });
      if (!updated) return;
      if (rescale?.clamped) {
        setNotice(m.scheduler_toast_capped({ max: MAX_HOURS_PER_DAY, shortcut: undoShortcut() }), "warning");
      }
      announceCapacity(capacityAnnouncement(resourceId));
      requestAnimationFrame(() => {
        const element = Array.from(document.querySelectorAll<HTMLElement>("[data-alloc-id]")).find(
          (candidate) => candidate.dataset.allocId === bar.allocation.id,
        );
        element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        element?.focus({ preventScroll: true });
      });
    } catch (error) {
      setNotice(error instanceof Error ? errorMessage(error) : m.scheduler_toast_move_disallowed(), "error");
    }
  };

  let left = bar.x;
  let width = bar.width;
  let translateY = 0;
  if (preview) {
    if (preview.mode === "move") translateY = preview.deltaY;
    // The snapped range is already on the preview (see onPreview) — all that is left per frame is
    // running it through the SAME ColumnGeometry the view-model placed bar.x / bar.width with, so
    // the preview stays pixel-identical to the committed bar even across a narrowed weekend.
    if (preview.deltaDays !== 0 && preview.dates) {
      left = geom.xForDateInGeom(preview.dates.startDate);
      width = geom.widthForDates(preview.dates.startDate, preview.dates.endDate);
    }
  }

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
