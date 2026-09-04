import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { m } from "@/i18n";
import { undoShortcut } from "../../lib/keyboardShortcuts";
import { errorMessage } from "../../lib/errorMessage";
import { applyGesture, type DateRange, type DragMode } from "../../lib/gestureMath";
import { rangesOverlap } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { carriesHourlyLoad, MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import type { ID, Weekday } from "@capacitylens/shared/types/entities";
import { useDragResize } from "../../hooks/useDragResize";
import { accountWorkingDaysFor, schedulingModeFor, visibleRange } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { computeGesture, reconcileReassignedHours, volumePreservingHoursClamped } from "./allocationDrag";
import type { ColumnGeometry } from "./columnGeometry";
import { effectiveWorkingDays, isAllocationMoveStartBlocked } from "./creationAvailability";
import type { BarLayout } from "./schedulerModel";
import { laneAt, snapshotLanes, type LaneSnapshot } from "./gestureLanes";
import { capacityAnnouncement, capacityGestureAdvisory } from "./gestureAnnouncements";
import { gesturePreviewDates, gesturePreviewGeometry } from "./gestureGeometry";

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

  /** A non-ignored gesture on a resource with NO effective working days is refused outright:
   *  working-span math is undefined there, and passing the collapsed empty week into GestureOpts
   *  would hit isWeekendAware's calendar-day fallback — silently rewriting stored hours the
   *  capacity model says load nothing. The move gates below catch start changes; this also covers
   *  a pure end-edge resize. Mirrors the modal's frozen Days-over for the same week. */
  const lacksEffectiveDaysFor = (targetResourceId: ID) => {
    if (bar.allocation.ignoreWeekends) return false;
    const state = useStore.getState();
    const resource = state.data.resources.find((candidate) => candidate.id === targetResourceId);
    if (!resource) return false;
    return effectiveWorkingWeek(resource, accountWorkingDaysFor(state.data, state.activeAccountId)).kind === "none";
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
      const previewDays = previewWorkingDaysFor(destination?.id ?? resourceId);
      const { previewImpossible, dates } = gesturePreviewDates(bar, mode, deltaDays, previewDays);
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
          (previewImpossible ||
            (!!dates &&
              isAllocationMoveStartBlocked(
                targetResource,
                dates.startDate,
                accountWorkingDaysFor(state.data, state.activeAccountId),
                bar.allocation.ignoreWeekends,
              )));
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
      // Resize only: a move (same-lane or reassign) is fully covered by the start gate below —
      // every none-week start day is non-working — and moving work AWAY from a none-week person
      // must stay possible. A pure end-edge resize never changes the start, so it needs this
      // explicit refusal to keep the empty week out of calendar-day volume math.
      if (mode !== "move" && lacksEffectiveDaysFor(effectiveResourceId)) {
        setNotice(m.scheduler_toast_no_effective_days_gesture(), "error");
        return;
      }
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
        ? reconcileReassignedHours(
            hours,
            targetResource,
            isBlocks,
            dates.startDate,
            effectiveWorkingWeek(targetResource, accountWorkingDaysFor(state.data, state.activeAccountId)),
          )
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
      const advisory = capacityGestureAdvisory(bar, effectiveResourceId, isBlocks, dates, reconciledHours);
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
    // Same resize-only refusal as the pointer commit path: keyboard moves fall through to the
    // start gate below, which already rejects every none-week start day.
    if (mode !== "move" && lacksEffectiveDaysFor(resourceId)) {
      setNotice(m.scheduler_toast_no_effective_days_gesture(), "error");
      return;
    }
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

  const { left, width, translateY } = gesturePreviewGeometry(bar, geom, preview);

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
