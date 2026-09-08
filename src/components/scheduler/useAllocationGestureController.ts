import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { m } from "@/i18n";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { rangesOverlap } from "@capacitylens/shared/lib/dateMath";
import { MAX_HOURS_PER_DAY, type ID, type Weekday } from "@capacitylens/shared/types/entities";
import { useDragResize, type DragResizePreviewInput, type Pointer } from "../../hooks/useDragResize";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { applyGesture, type DateRange, type DragMode } from "../../lib/gestureMath";
import { buildUndoShortcut } from "../../lib/keyboardShortcuts";
import { buildVisibleRange, listAccountWorkingDays } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { reconcileReassignedHours, resolveGesture, resolveVolumePreservingHours } from "./allocationDrag";
import { isAllocationMoveStartBlocked, resolveEffectiveWorkingDays } from "./creationAvailability";
import { readCapacityAnnouncement, readCapacityGestureAdvisory } from "./gestureAnnouncements";
import { buildGesturePreviewDates } from "./gestureGeometry";
import { readLaneSnapshots, resolveLaneAt, type LaneSnapshot } from "./gestureLanes";
import type { BarLayout } from "./schedulerModel";

interface GesturePreview {
  mode: DragMode;
  deltaDays: number;
  deltaY: number;
  targetResourceId: ID | null;
  // The snapped range is computed once where the pointer is handled. `null` means that a
  // zero-column resize keeps the view-model's existing placement.
  dates: DateRange | null;
}

interface ControllerOptions {
  bar: BarLayout;
  indexAtClientX: (clientX: number) => number;
  isDays: boolean;
  isBlocks: boolean;
  onEdit?: (id: ID) => void;
}

interface GestureRuntime {
  lanesRef: React.RefObject<LaneSnapshot[]>;
  previewDaysRef: React.RefObject<Map<ID, Weekday[] | undefined>>;
  setDropTarget: (element: HTMLElement | null) => void;
  startGeometryWatch: () => void;
  stopGeometryWatch: () => void;
}

function readWorkingDays(resourceId: ID) {
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  return resource
    ? resolveEffectiveWorkingDays(resource, listAccountWorkingDays(state.data, state.activeAccountId))
    : undefined;
}

function hasEffectiveDaysFor(bar: BarLayout, resourceId: ID) {
  if (bar.allocation.ignoreWeekends) return true;
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return true;
  return effectiveWorkingWeek(resource, listAccountWorkingDays(state.data, state.activeAccountId)).kind !== "none";
}

function refuseIneffectiveResize(bar: BarLayout, mode: DragMode, resourceId: ID) {
  // Move starts are covered by the non-working-day gate, including moves away from a none-week
  // resource. A pure end resize needs this explicit refusal: otherwise the collapsed empty week
  // falls back to calendar-day volume math and rewrites hours that the capacity model says load none.
  if (mode === "move" || hasEffectiveDaysFor(bar, resourceId)) return false;
  useStore.getState().setNotice(m.scheduler_toast_no_effective_days_gesture(), "error");
  return true;
}

function resolvePreviewDays(runtime: GestureRuntime, resourceId: ID) {
  // A working-week edit cannot land mid-gesture, so memoizing once per resource is exact. The
  // runtime clears this at gesture start and teardown; commits and nudges always read live data.
  const memo = runtime.previewDaysRef.current;
  if (memo.has(resourceId)) return memo.get(resourceId);
  const workingDays = readWorkingDays(resourceId);
  memo.set(resourceId, workingDays);
  return workingDays;
}

function isPreviewDestinationBlocked(
  bar: BarLayout,
  destination: LaneSnapshot | null,
  result: ReturnType<typeof buildGesturePreviewDates>,
) {
  if (!destination) return false;
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === destination.id);
  if (!resource || result.kind === "blocked") return !!resource;
  if (result.kind !== "ready") return false;
  return isAllocationMoveStartBlocked({
    resource,
    date: result.dates.startDate,
    accountWorkingDays: listAccountWorkingDays(state.data, state.activeAccountId),
    ignoreWorkingDays: bar.allocation.ignoreWeekends,
  });
}

function previewGesture(options: ControllerOptions, runtime: GestureRuntime, input: DragResizePreviewInput) {
  const { bar } = options;
  const resourceId = bar.allocation.resourceId;
  const target =
    input.mode === "move"
      ? resolveLaneAt(runtime.lanesRef.current, input.pointer.clientX, input.pointer.clientY)
      : null;
  const destination = target && target.id !== resourceId ? target : null;
  const previewDays = resolvePreviewDays(runtime, destination?.id ?? resourceId);
  const result = buildGesturePreviewDates({ bar, mode: input.mode, deltaDays: input.deltaDays, previewDays });
  const dates = result.kind === "ready" ? result.dates : null;
  const preview = { ...input, targetResourceId: target?.id ?? null, dates };
  if (input.mode !== "move") return { preview, dropTarget: undefined };
  const blocked = isPreviewDestinationBlocked(bar, destination, result);
  return { preview, dropTarget: destination && !blocked ? destination.el : null };
}

interface ResolveCommitInput {
  options: ControllerOptions;
  mode: DragMode;
  deltaDays: number;
  resourceId: ID;
}

function resolveCommitDates({ options, mode, deltaDays, resourceId }: ResolveCommitInput) {
  const { bar, isDays } = options;
  const workingDays = readWorkingDays(resourceId);
  return resolveGesture({
    mode,
    current: { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate },
    deltaDays,
    options: {
      ...(workingDays !== undefined ? { workingDays } : {}),
      ...(bar.allocation.ignoreWeekends !== undefined ? { ignoreWeekends: bar.allocation.ignoreWeekends } : {}),
    },
    hoursPerDay: bar.allocation.hoursPerDay,
    isDays,
  });
}

interface CommitGateInput {
  options: ControllerOptions;
  mode: DragMode;
  resourceId: ID;
  dates: DateRange;
}

function isCommitBlocked({ options, mode, resourceId, dates }: CommitGateInput) {
  const { bar } = options;
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  const startChanged = dates.startDate !== bar.allocation.startDate;
  if (!resource || (mode !== "move" && !startChanged)) return false;
  const blocked = isAllocationMoveStartBlocked({
    resource,
    date: dates.startDate,
    accountWorkingDays: listAccountWorkingDays(state.data, state.activeAccountId),
    ignoreWorkingDays: bar.allocation.ignoreWeekends,
  });
  if (blocked) state.setNotice(m.scheduler_toast_non_working_drop(), "error");
  return blocked;
}

interface ReconcileCommitInput {
  options: ControllerOptions;
  targetResourceId: ID | null;
  dates: DateRange;
  hours: number;
}

function reconcileCommitHours({ options, targetResourceId, dates, hours }: ReconcileCommitInput) {
  if (!targetResourceId) return hours;
  const state = useStore.getState();
  const target = state.data.resources.find((resource) => resource.id === targetResourceId);
  if (!target) return hours;
  return reconcileReassignedHours({
    current: hours,
    target,
    zeroLoadMode: options.isBlocks,
    startDate: dates.startDate,
    effectiveWeek: effectiveWorkingWeek(target, listAccountWorkingDays(state.data, state.activeAccountId)),
  });
}

interface SavePointerCommitInput {
  options: ControllerOptions;
  effectiveResourceId: ID;
  targetResourceId: ID | null;
  result: ReturnType<typeof resolveCommitDates>;
}

function savePointerCommit({ options, effectiveResourceId, targetResourceId, result }: SavePointerCommitInput) {
  const { bar, isBlocks } = options;
  const { setNotice, updateAllocation } = useStore.getState();
  const reconciledHours = reconcileCommitHours({
    options,
    targetResourceId,
    dates: result.dates,
    hours: result.hours,
  });
  try {
    const updated = updateAllocation(bar.allocation.id, {
      ...result.dates,
      ...(reconciledHours !== bar.allocation.hoursPerDay ? { hoursPerDay: reconciledHours } : null),
      ...(targetResourceId ? { resourceId: targetResourceId } : {}),
    });
    if (!updated) return;
  } catch (error) {
    // A diagonal drag is one transaction. A rejected reassignment must not commit its horizontal
    // component as a second update.
    setNotice(error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_rejected(), "error");
    return;
  }
  // Advisory work follows the mutation so a programmer error cannot be mislabeled as rejection.
  const advisory = readCapacityGestureAdvisory({
    bar,
    effectiveResourceId,
    isBlocks,
    dates: result.dates,
    reconciledHours,
  });
  const dayCapacity = result.clamped ? m.scheduler_cap_fragment({ max: MAX_HOURS_PER_DAY }) : "";
  setNotice(
    `${targetResourceId ? m.scheduler_toast_reassigned() : m.scheduler_toast_moved()}${advisory}.${dayCapacity}${m.scheduler_toast_undo_hint({ shortcut: buildUndoShortcut() })}`,
    result.clamped ? "warning" : "info",
  );
}

interface PointerCommitInput {
  mode: DragMode;
  deltaDays: number;
  pointer: Pointer;
}

function commitPointerGesture(options: ControllerOptions, runtime: GestureRuntime, input: PointerCommitInput) {
  const { mode, deltaDays, pointer } = input;
  // The final hit test is authoritative. Refresh move-lane geometry even if a scroll/resize
  // observer callback has not run yet, then stop its queued preview refresh.
  if (mode === "move") runtime.lanesRef.current = readLaneSnapshots();
  runtime.stopGeometryWatch();
  const resourceId = options.bar.allocation.resourceId;
  const target = mode === "move" ? resolveLaneAt(runtime.lanesRef.current, pointer.clientX, pointer.clientY) : null;
  const targetResourceId = target && target.id !== resourceId ? target.id : null;
  runtime.setDropTarget(null);
  if (deltaDays === 0 && !targetResourceId) return;
  const effectiveResourceId = targetResourceId ?? resourceId;
  if (refuseIneffectiveResize(options.bar, mode, effectiveResourceId)) return;
  const result = resolveCommitDates({ options, mode, deltaDays, resourceId: effectiveResourceId });
  if (isCommitBlocked({ options, mode, resourceId: effectiveResourceId, dates: result.dates })) return;
  savePointerCommit({ options, effectiveResourceId, targetResourceId, result });
}

function resolveKeyboardGesture(options: ControllerOptions, mode: DragMode, deltaDays: number) {
  const { bar } = options;
  const workingDays = readWorkingDays(bar.allocation.resourceId);
  const gestureOptions = {
    ...(workingDays !== undefined ? { workingDays } : {}),
    ...(bar.allocation.ignoreWeekends !== undefined ? { ignoreWeekends: bar.allocation.ignoreWeekends } : {}),
  };
  const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate };
  const next = applyGesture({ mode, range: current, deltaDays, options: gestureOptions });
  return { current, next, gestureOptions };
}

interface KeyboardGateInput {
  options: ControllerOptions;
  mode: DragMode;
  current: DateRange;
  next: DateRange;
}

function isKeyboardGestureBlocked({ options, mode, current, next }: KeyboardGateInput) {
  const { bar } = options;
  if (next.endDate < next.startDate) return true;
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === bar.allocation.resourceId);
  const startBlocked =
    (mode === "move" || next.startDate !== current.startDate) &&
    !!resource &&
    isAllocationMoveStartBlocked({
      resource,
      date: next.startDate,
      accountWorkingDays: listAccountWorkingDays(state.data, state.activeAccountId),
      ignoreWorkingDays: bar.allocation.ignoreWeekends,
    });
  if (startBlocked) {
    state.setNotice(m.scheduler_toast_non_working_drop(), "error");
    return true;
  }
  const visible = buildVisibleRange(state.ui);
  const leavesTimeline =
    rangesOverlap(current.startDate, current.endDate, visible.start, visible.end) &&
    !rangesOverlap(next.startDate, next.endDate, visible.start, visible.end);
  if (leavesTimeline) state.setNotice(m.scheduler_keyboard_outside_timeline(), "error");
  return leavesTimeline;
}

function focusAllocation(allocationId: ID) {
  requestAnimationFrame(() => {
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-alloc-id]")).find(
      (candidate) => candidate.dataset.allocId === allocationId,
    );
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    element?.focus({ preventScroll: true });
  });
}

function saveKeyboardGesture(
  options: ControllerOptions,
  next: DateRange,
  rescale: ReturnType<typeof resolveVolumePreservingHours> | null,
) {
  const { bar } = options;
  const { setNotice, updateAllocation, announceCapacity } = useStore.getState();
  try {
    const updated = updateAllocation(bar.allocation.id, {
      ...next,
      ...(rescale ? { hoursPerDay: rescale.hours } : null),
    });
    if (!updated) return;
    if (rescale?.clamped) {
      setNotice(m.scheduler_toast_capped({ max: MAX_HOURS_PER_DAY, shortcut: buildUndoShortcut() }), "warning");
    }
    announceCapacity(readCapacityAnnouncement(bar.allocation.resourceId));
    focusAllocation(bar.allocation.id);
  } catch (error) {
    setNotice(error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_disallowed(), "error");
  }
}

function nudgeAllocation(options: ControllerOptions, mode: DragMode, deltaDays: number) {
  const { bar } = options;
  if (refuseIneffectiveResize(bar, mode, bar.allocation.resourceId)) return;
  const { current, next, gestureOptions } = resolveKeyboardGesture(options, mode, deltaDays);
  if (isKeyboardGestureBlocked({ options, mode, current, next })) return;
  const rescale =
    options.isDays && mode !== "move"
      ? resolveVolumePreservingHours({
          previousDate: current,
          next,
          options: gestureOptions,
          hoursPerDay: bar.allocation.hoursPerDay,
        })
      : null;
  const unchanged =
    next.startDate === current.startDate &&
    next.endDate === current.endDate &&
    (rescale === null || rescale.hours === bar.allocation.hoursPerDay);
  if (unchanged) return;
  saveKeyboardGesture(options, next, rescale);
}

export function useAllocationGestureController(options: ControllerOptions, runtime: GestureRuntime) {
  const { bar, indexAtClientX, onEdit } = options;
  const [preview, setPreview] = useState<GesturePreview | null>(null);
  // Store writes are read at call time: action identities do not change, and every handler already
  // needs live state for the data it commits against.
  const setDragging = (id: ID | null) => useStore.getState().setDraggingAllocation(id);
  const { onPointerDown: armPointerGesture } = useDragResize({
    indexAtClientX,
    onPreview: (input) => {
      if (!preview) setDragging(bar.allocation.id);
      const result = previewGesture(options, runtime, input);
      setPreview(result.preview);
      if (result.dropTarget !== undefined) runtime.setDropTarget(result.dropTarget);
    },
    onClick: () => {
      runtime.stopGeometryWatch();
      setDragging(null);
      onEdit?.(bar.allocation.id);
    },
    onCancel: () => {
      runtime.stopGeometryWatch();
      setDragging(null);
      setPreview(null);
      runtime.setDropTarget(null);
    },
    onCommit: (mode, deltaDays, pointer) => {
      setPreview(null);
      setDragging(null);
      commitPointerGesture(options, runtime, { mode, deltaDays, pointer });
    },
  });
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!armPointerGesture(event)) return;
    runtime.lanesRef.current = readLaneSnapshots();
    runtime.startGeometryWatch();
  };
  return { preview, onPointerDown, nudge: (mode: DragMode, delta: number) => nudgeAllocation(options, mode, delta) };
}
