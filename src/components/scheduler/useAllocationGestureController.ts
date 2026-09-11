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
import { readCapacityAnnouncement, readCapacityGestureAdvisory } from "./gestureAnnouncements";
import { buildGesturePreviewDates } from "./gestureGeometry";
import {
  hasEffectiveDaysFor,
  isDropStartBlocked,
  readWorkingDays,
  resolveMemoisedWorkingDays,
} from "./gestureWorkingWeeks";
import { readLaneSnapshots, resolveLaneAt, type LaneSnapshot } from "./gestureLanes";
import type { BarLayout } from "./schedulerModel";
import { useAllocationFocus, type ScheduleAllocationFocus } from "./useAllocationFocus";

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

function refuseIneffectiveResize(bar: BarLayout, mode: DragMode, resourceId: ID) {
  // Move starts are covered by the non-working-day gate, including moves away from a none-week
  // resource. A pure end resize needs this explicit refusal: otherwise the collapsed empty week
  // falls back to calendar-day volume math and rewrites hours that the capacity model says load none.
  if (mode === "move" || hasEffectiveDaysFor({ resourceId, ignoreWeekends: bar.allocation.ignoreWeekends }))
    return false;
  useStore.getState().setNotice(m.scheduler_toast_no_effective_days_gesture(), "error");
  return true;
}

function isPreviewDestinationBlocked(
  bar: BarLayout,
  destination: LaneSnapshot | null,
  result: ReturnType<typeof buildGesturePreviewDates>,
) {
  if (!destination) return false;
  // A lane whose resource vanished mid-drag is nothing to highlight, but nor is it "blocked" —
  // there is no placement to refuse. `readWorkingDays` is undefined only when the resource is gone.
  if (readWorkingDays(destination.id) === undefined) return false;
  if (result.kind === "blocked") return true;
  if (result.kind !== "ready") return false;
  return isDropStartBlocked({
    resourceId: destination.id,
    date: result.dates.startDate,
    ignoreWeekends: bar.allocation.ignoreWeekends,
  });
}

interface ReadPreviewDatesInput {
  bar: BarLayout;
  runtime: GestureRuntime;
  input: DragResizePreviewInput;
  destination: LaneSnapshot | null;
}

/** The snapped range for this frame, judged in the lane the pointer is over. A reassignment also
 *  carries the dragged bar's OWN week, which is what sizes the range. */
function readPreviewDates({ bar, runtime, input, destination }: ReadPreviewDatesInput) {
  const resourceId = bar.allocation.resourceId;
  return buildGesturePreviewDates({
    bar,
    mode: input.mode,
    deltaDays: input.deltaDays,
    previewDays: resolveMemoisedWorkingDays(runtime.previewDaysRef.current, destination?.id ?? resourceId),
    sourceDays: destination ? resolveMemoisedWorkingDays(runtime.previewDaysRef.current, resourceId) : undefined,
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
  const result = readPreviewDates({ bar, runtime, input, destination });
  // A drop the commit will refuse must not be drawn: the preview would show a range the release is
  // about to reject, then snap back. Only a settled range reaches the pixels.
  const blocked = input.mode === "move" && isPreviewDestinationBlocked(bar, destination, result);
  const preview: GesturePreview = {
    mode: input.mode,
    deltaDays: input.deltaDays,
    deltaY: input.deltaY,
    targetResourceId: target?.id ?? null,
    dates: result.kind === "ready" && !blocked ? result.dates : null,
  };
  if (input.mode !== "move") return { preview, dropTarget: undefined };
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
  const source = bar.allocation.resourceId;
  const workingDays = readWorkingDays(resourceId);
  // A reassignment keeps the duration its ORIGIN measured; only the placement is the target's.
  const sourceWorkingDays = resourceId === source ? workingDays : readWorkingDays(source);
  return resolveGesture({
    mode,
    current: { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate },
    deltaDays,
    options: {
      ...(workingDays !== undefined ? { workingDays } : {}),
      ...(sourceWorkingDays !== undefined ? { sourceWorkingDays } : {}),
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
  const startChanged = dates.startDate !== bar.allocation.startDate;
  if (mode !== "move" && !startChanged) return false;
  const blocked = isDropStartBlocked({
    resourceId,
    date: dates.startDate,
    ignoreWeekends: bar.allocation.ignoreWeekends,
  });
  if (blocked) useStore.getState().setNotice(m.scheduler_toast_non_working_drop(), "error");
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
  const startBlocked =
    (mode === "move" || next.startDate !== current.startDate) &&
    isDropStartBlocked({
      resourceId: bar.allocation.resourceId,
      date: next.startDate,
      ignoreWeekends: bar.allocation.ignoreWeekends,
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

function saveKeyboardGesture(
  options: ControllerOptions,
  scheduleFocus: ScheduleAllocationFocus,
  input: { next: DateRange; rescale: ReturnType<typeof resolveVolumePreservingHours> | null },
) {
  const { bar } = options;
  const { next, rescale } = input;
  const { activeAccountId, setNotice, updateAllocation, announceCapacity } = useStore.getState();
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
    scheduleFocus(bar.allocation.id, activeAccountId);
  } catch (error) {
    setNotice(error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_disallowed(), "error");
  }
}

function nudgeAllocation(
  options: ControllerOptions,
  scheduleFocus: ScheduleAllocationFocus,
  input: { mode: DragMode; deltaDays: number },
) {
  const { bar } = options;
  const { mode, deltaDays } = input;
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
  saveKeyboardGesture(options, scheduleFocus, { next, rescale });
}

function startPointerGesture(runtime: GestureRuntime) {
  runtime.lanesRef.current = readLaneSnapshots();
  runtime.startGeometryWatch();
}

export function useAllocationGestureController(options: ControllerOptions, runtime: GestureRuntime) {
  const { bar, indexAtClientX, onEdit } = options;
  const [preview, setPreview] = useState<GesturePreview | null>(null);
  const scheduleFocus = useAllocationFocus();
  // Read store actions at call time because handlers commit against live state.
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
  const beginPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!armPointerGesture(event)) return;
    startPointerGesture(runtime);
  };
  return {
    preview,
    onPointerDown: beginPointerGesture,
    nudge: (mode: DragMode, delta: number) => nudgeAllocation(options, scheduleFocus, { mode, deltaDays: delta }),
  };
}
