import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { m } from '@/i18n';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { rangesOverlap } from '@capacitylens/shared/lib/dateMath';
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities';
import type { Allocation, ID, Weekday } from '@capacitylens/shared/types/entities';
import { useDragResize } from '@/hooks/useDragResize';
import type { DragResizePreviewInput, Pointer } from '@/hooks/useDragResize';
import { isShownByPlanningState } from '@/data/planning/planningNotices';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { applyGesture } from '@/lib/gestureMath';
import type { DateRange, DragMode } from '@/lib/gestureMath';
import { buildUndoShortcut } from '@/lib/keyboardShortcuts';
import { buildVisibleRange, listAccountWorkingDays } from '@/store/selectors';
import { useStore } from '@/store/useStore';
import {
  reconcileReassignedHours,
  resolveGesture,
  resolveVolumePreservingHours,
} from './allocationDrag';
import { buildCapacityAnnouncement, buildCapacityGestureAdvisory } from './gestureAnnouncements';
import type { GestureCapacitySource } from './gestureAnnouncements';
import { buildGesturePreviewDates } from './gestureGeometry';
import {
  hasEffectiveDaysFor,
  isDropStartBlocked,
  isPreviewDropBlocked,
  resolveGestureWorkingDays,
  resolveMemoisedWorkingDays,
} from './gestureWorkingWeeks';
import type { GestureCalendar } from './gestureWorkingWeeks';
import { buildActiveGestureData, readLaneSnapshots, resolveLaneAt } from './gestureLanes';
import type { LaneSnapshot } from './gestureLanes';
import type { BarLayout } from './schedulerModel';
import { useAllocationFocus } from './useAllocationFocus';
import type { ScheduleAllocationFocus } from './useAllocationFocus';

interface GesturePreview {
  mode: DragMode;
  deltaDays: number;
  deltaY: number;
  targetResourceId: ID | null;

  dates: DateRange | null;
}

interface ControllerOptions {
  bar: BarLayout;
  indexAtClientX: (clientX: number) => number;
  isDays: boolean;
  isBlocks: boolean;
  onEdit?: (id: ID) => void;
}

/** Per-allocation refs and geometry watch shared by the gesture hook and its controller. */
export interface GestureRuntime {
  lanesRef: React.RefObject<LaneSnapshot[]>;
  previewDaysRef: React.RefObject<Map<ID, Weekday[] | undefined>>;
  setDropTarget: (element: HTMLElement | null) => void;
  startGeometryWatch: () => void;
  stopGeometryWatch: () => void;
}

// The gesture helpers are pure; each read below takes the live store at the moment of the call so
// a commit or keyboard action never acts on a calendar captured earlier in the gesture.
function readGestureCalendar(): GestureCalendar {
  const state = useStore.getState();
  return {
    resources: state.data.resources,
    accountWorkingDays: listAccountWorkingDays(state.data, state.activeAccountId),
  };
}

function readGestureCapacitySource(): GestureCapacitySource {
  const { data, activeAccountId } = useStore.getState();
  return {
    data: buildActiveGestureData(data, activeAccountId),
    accountWorkingDays: listAccountWorkingDays(data, activeAccountId),
  };
}

// Reads the figures the store holds now; the caller checks they come from a read after the write.
function readCapacityAnnouncement(resourceId: ID): string {
  const { data, planning, ui } = useStore.getState();
  return buildCapacityAnnouncement({
    resources: data.resources,
    capacity: planning.capacity,
    resourceId,
    visibleRange: buildVisibleRange(ui),
  });
}

function refuseIneffectiveResize(bar: BarLayout, mode: DragMode, resourceId: ID) {
  // A resize cannot preserve working-day volume when the resource has no effective days.
  if (
    mode === 'move' ||
    hasEffectiveDaysFor({
      calendar: readGestureCalendar(),
      resourceId,
      ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
    })
  ) {
    return false;
  }
  useStore.getState().setNotice(m.scheduler_toast_no_effective_days_gesture(), 'error');
  return true;
}

interface ReadPreviewDatesInput {
  bar: {
    allocation: Pick<Allocation, 'resourceId' | 'startDate' | 'endDate' | 'ignoreWorkingDays'>;
  };
  runtime: Pick<GestureRuntime, 'previewDaysRef'>;
  input: Pick<DragResizePreviewInput, 'mode' | 'deltaDays'>;
  destination: Pick<LaneSnapshot, 'id'> | null;
}

function readPreviewDates({ bar, runtime, input, destination }: ReadPreviewDatesInput) {
  const resourceId = bar.allocation.resourceId;
  const previewDays = resolveMemoisedWorkingDays(
    runtime.previewDaysRef.current,
    destination?.id ?? resourceId,
    readGestureCalendar,
  );
  return {
    result: buildGesturePreviewDates({
      allocation: bar.allocation,
      mode: input.mode,
      deltaDays: input.deltaDays,
      previewDays,
      sourceDays: destination
        ? resolveMemoisedWorkingDays(
            runtime.previewDaysRef.current,
            resourceId,
            readGestureCalendar,
          )
        : undefined,
      isReassignment: destination !== null,
    }),
    previewDays,
  };
}

function previewGesture(
  options: ControllerOptions,
  runtime: GestureRuntime,
  input: DragResizePreviewInput,
) {
  const { bar } = options;
  const resourceId = bar.allocation.resourceId;
  const target =
    input.mode === 'move'
      ? resolveLaneAt(runtime.lanesRef.current, input.pointer.clientX, input.pointer.clientY)
      : null;
  const destination = target && target.id !== resourceId ? target : null;
  const { result, previewDays } = readPreviewDates({ bar, runtime, input, destination });
  // A refused reassignment previews the source-row range so the bar continues following horizontal movement without painting a destination placement that commit rejects.
  const blocked = isPreviewDropBlocked({
    workingDays: previewDays,
    result,
    isReassignment: input.mode === 'move' && destination !== null,
    ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
  });
  const settled = blocked
    ? readPreviewDates({ bar, runtime, input, destination: null }).result
    : result;
  const preview: GesturePreview = {
    mode: input.mode,
    deltaDays: input.deltaDays,
    deltaY: input.deltaY,
    targetResourceId: target?.id ?? null,
    dates: settled.kind === 'ready' ? settled.dates : null,
  };
  if (input.mode !== 'move') return { preview, dropTarget: undefined };
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
  const calendar = readGestureCalendar();
  const workingDays = resolveGestureWorkingDays(calendar, resourceId);
  // A reassignment keeps the duration its origin measured; only the placement is the target's.
  const sourceWorkingDays =
    resourceId === source ? workingDays : resolveGestureWorkingDays(calendar, source);
  return resolveGesture({
    mode,
    current: { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate },
    deltaDays,
    options: {
      ...(workingDays !== undefined ? { workingDays } : {}),
      ...(sourceWorkingDays !== undefined ? { sourceWorkingDays } : {}),
      ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
    },
    hoursPerDay: bar.allocation.hoursPerDay,
    isDays,
  });
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
    effectiveWeek: effectiveWorkingWeek(
      target,
      listAccountWorkingDays(state.data, state.activeAccountId),
    ),
  });
}

interface SavePointerCommitInput {
  options: ControllerOptions;
  effectiveResourceId: ID;
  targetResourceId: ID | null;
  result: ReturnType<typeof resolveCommitDates>;
}

async function savePointerCommit({
  options,
  effectiveResourceId,
  targetResourceId,
  result,
}: SavePointerCommitInput) {
  const { bar, isBlocks } = options;
  const { setNotice, updateAllocation } = useStore.getState();
  const reconciledHours = reconcileCommitHours({
    options,
    targetResourceId,
    dates: result.dates,
    hours: result.hours,
  });
  try {
    const updated = await updateAllocation(bar.allocation.id, {
      ...result.dates,
      ...(reconciledHours !== bar.allocation.hoursPerDay ? { hoursPerDay: reconciledHours } : null),
      ...(targetResourceId ? { resourceId: targetResourceId } : {}),
    });
    if (!updated) return;
  } catch (error) {
    // A diagonal drag is one transaction. A rejected reassignment must not commit its horizontal
    // component as a second update.
    if (isShownByPlanningState(error)) return;
    setNotice(
      error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_rejected(),
      'error',
    );
    return;
  }
  // Advisory work follows the mutation so a programmer error cannot be mislabeled as rejection.
  const advisory = buildCapacityGestureAdvisory({
    source: readGestureCapacitySource(),
    bar,
    effectiveResourceId,
    isBlocks,
    dates: result.dates,
    reconciledHours,
  });
  const dayCapacity = result.clamped ? m.scheduler_cap_fragment({ max: MAX_HOURS_PER_DAY }) : '';
  setNotice(
    `${targetResourceId ? m.scheduler_toast_reassigned() : m.scheduler_toast_moved()}${advisory}.${dayCapacity}${m.scheduler_toast_undo_hint({ shortcut: buildUndoShortcut() })}`,
    result.clamped ? 'warning' : 'info',
  );
}

interface PointerCommitInput {
  mode: DragMode;
  deltaDays: number;
  pointer: Pointer;
}

function commitPointerGesture(
  options: ControllerOptions,
  runtime: GestureRuntime,
  input: PointerCommitInput,
) {
  const { mode, deltaDays, pointer } = input;
  // The final hit test is authoritative. Refresh move-lane geometry even if a scroll/resize
  // observer callback has not run yet, then stop its queued preview refresh.
  if (mode === 'move') runtime.lanesRef.current = readLaneSnapshots();
  runtime.stopGeometryWatch();
  const resourceId = options.bar.allocation.resourceId;
  const target =
    mode === 'move'
      ? resolveLaneAt(runtime.lanesRef.current, pointer.clientX, pointer.clientY)
      : null;
  const targetResourceId = target && target.id !== resourceId ? target.id : null;
  runtime.setDropTarget(null);
  if (deltaDays === 0 && !targetResourceId) return;
  const effectiveResourceId = targetResourceId ?? resourceId;
  if (refuseIneffectiveResize(options.bar, mode, effectiveResourceId)) return;
  const result = resolveCommitDates({ options, mode, deltaDays, resourceId: effectiveResourceId });
  if (
    targetResourceId &&
    isDropStartBlocked({
      calendar: readGestureCalendar(),
      resourceId: targetResourceId,
      date: result.dates.startDate,
      ignoreWorkingDays: options.bar.allocation.ignoreWorkingDays,
    })
  ) {
    useStore.getState().setNotice(m.scheduler_toast_non_working_drop(), 'error');
    return;
  }
  void savePointerCommit({ options, effectiveResourceId, targetResourceId, result });
}

function resolveKeyboardGesture(options: ControllerOptions, mode: DragMode, deltaDays: number) {
  const { bar } = options;
  const workingDays = resolveGestureWorkingDays(readGestureCalendar(), bar.allocation.resourceId);
  const gestureOptions = {
    ...(workingDays !== undefined ? { workingDays } : {}),
    ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
  };
  const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate };
  const next = applyGesture({ mode, range: current, deltaDays, options: gestureOptions });
  return { current, next, gestureOptions };
}

interface KeyboardGateInput {
  current: DateRange;
  next: DateRange;
}

function refuseBlockedKeyboardGesture({ current, next }: KeyboardGateInput) {
  if (next.endDate < next.startDate) return true;
  const state = useStore.getState();
  const visible = buildVisibleRange(state.ui);
  const leavesTimeline =
    rangesOverlap(current.startDate, current.endDate, visible.start, visible.end) &&
    !rangesOverlap(next.startDate, next.endDate, visible.start, visible.end);
  if (leavesTimeline) state.setNotice(m.scheduler_keyboard_outside_timeline(), 'error');
  return leavesTimeline;
}

async function saveKeyboardGesture(
  options: ControllerOptions,
  scheduleFocus: ScheduleAllocationFocus,
  input: { next: DateRange; rescale: ReturnType<typeof resolveVolumePreservingHours> | null },
) {
  const { bar } = options;
  const { next, rescale } = input;
  const { activeAccountId, setNotice, updateAllocation, announceCapacity } = useStore.getState();
  try {
    const updated = await updateAllocation(bar.allocation.id, {
      ...next,
      ...(rescale ? { hoursPerDay: rescale.hours } : null),
    });
    if (!updated) return;
    if (rescale?.clamped) {
      setNotice(
        m.scheduler_toast_capped({ max: MAX_HOURS_PER_DAY, shortcut: buildUndoShortcut() }),
        'warning',
      );
    }
    // A cleared pending write means a read at or after its revision was accepted. Otherwise the
    // follow-up read failed or was overtaken, the figures may predate the write, and nothing is said.
    if (useStore.getState().planning.pending === null) {
      announceCapacity(readCapacityAnnouncement(bar.allocation.resourceId));
    }
    scheduleFocus(bar.allocation.id, activeAccountId);
  } catch (error) {
    // Surface a refused gesture commit so preview feedback cannot imply that a rejected move saved.
    if (isShownByPlanningState(error)) return;
    setNotice(
      error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_disallowed(),
      'error',
    );
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
  if (refuseBlockedKeyboardGesture({ current, next })) return;
  const rescale =
    options.isDays && mode !== 'move'
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
  void saveKeyboardGesture(options, scheduleFocus, { next, rescale });
}

function startPointerGesture(runtime: GestureRuntime) {
  runtime.lanesRef.current = readLaneSnapshots();
  runtime.startGeometryWatch();
}

/** Coordinates pointer and keyboard allocation gestures with preview and commit state. */
export function useAllocationGestureController(
  options: ControllerOptions,
  runtime: GestureRuntime,
) {
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
    nudge: (mode: DragMode, delta: number) =>
      nudgeAllocation(options, scheduleFocus, { mode, deltaDays: delta }),
  };
}
