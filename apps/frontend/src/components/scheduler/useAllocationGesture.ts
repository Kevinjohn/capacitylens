import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { m } from '@/i18n'
import { hasRangeOverlap } from '@capacitylens/shared/lib/dateMath'
import { MAX_HOURS_PER_DAY, hasHourlyLoad } from '@capacitylens/shared/types/entities'
import type { Allocation, ID } from '@capacitylens/shared/types/entities'
import { useDragResize } from '@/hooks/useDragResize'
import type { DragResizePreviewInput } from '@/hooks/useDragResize'
import { isShownByPlanningState } from '@/data/planning/planningNotices'
import { resolveErrorMessage } from '@/lib/errorMessage'
import { applyGesture } from '@/lib/gestureMath'
import type { DateRange, DragMode } from '@/lib/gestureMath'
import { buildUndoShortcut } from '@/lib/keyboardShortcuts'
import { formatCapacityAdvisory } from '@/lib/capacity/advisoryCopy'
import { buildVisibleRange, listCompanyWorkingDays, resolveSchedulingMode } from '@/store/selectors'
import { useStore } from '@/store/useStore'
import { resolveGesture, resolveVolumePreservingHours } from './allocationDrag'
import type { ColumnGeometry } from './columnGeometry'
import { buildCapacityAnnouncement } from './gestureAnnouncements'
import { buildGesturePreviewDates, buildGesturePreviewGeometry } from './gestureGeometry'
import {
  hasEffectiveDaysFor,
  isDropStartBlocked,
  resolveGestureWorkingDays,
} from './gestureWorkingWeeks'
import type { GestureCalendar } from './gestureWorkingWeeks'
import type { BarLayout } from './schedulerModel'

interface AllocationGestureOptions {
  bar: BarLayout
  geom: ColumnGeometry
  indexAtClientX: (clientX: number) => number
  onEdit?: (id: ID) => void
}

/** The bar a gesture acts on and whether its company schedules in whole days. */
interface GestureSubject {
  bar: BarLayout
  isDays: boolean
}

interface GesturePreview {
  mode: DragMode
  deltaDays: number
  deltaY: number
  targetResourceId: ID | null

  dates: DateRange | null
}

// The gesture helpers are pure; each read below takes the live store at the moment of the call so
// a commit or keyboard action never acts on a calendar captured earlier in the gesture.
function readGestureCalendar(): GestureCalendar {
  const state = useStore.getState()
  return {
    resources: state.data.resources,
    companyWorkingDays: listCompanyWorkingDays(state.data, state.activeCompanyId),
  }
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
    return false
  }
  useStore.getState().setNotice(m.scheduler_toast_no_effective_days_gesture(), 'error')
  return true
}

// ---------------------------------------------------------------------------------------------
// Arm: measure the lanes on pointer down and keep them current while the pointer is held.

/** Measured lane bounds and resource identity used during pointer hit testing. */
interface LaneSnapshot {
  id: string
  el: HTMLElement
  rect: DOMRect
}

/** Reads current lane bounds from the rendered scheduler grid. */
function readLaneSnapshots(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-resource-id]')).map((el) => ({
    id: el.getAttribute('data-resource-id') ?? '',
    el,
    rect: el.getBoundingClientRect(),
  }))
}

/** Finds the measured lane under a pointer coordinate. */
function resolveLaneAt(
  lanes: LaneSnapshot[],
  clientX: number,
  clientY: number
): LaneSnapshot | undefined {
  for (const lane of lanes) {
    const { rect } = lane
    // Vertical lane intervals are half-open so adjacent rows cannot both own their shared edge.
    // The following row includes that coordinate through its `top` comparison.
    if (
      clientY >= rect.top &&
      clientY < rect.bottom &&
      clientX >= rect.left &&
      clientX <= rect.right
    ) {
      return lane
    }
  }
  return undefined
}

function watchLaneGeometry(
  lanesRef: React.RefObject<LaneSnapshot[]>,
  lanesDirtyRef: React.RefObject<boolean>
) {
  let animationFrame = 0
  const refreshDirtyLanes = () => {
    if (!lanesDirtyRef.current) return
    lanesRef.current = readLaneSnapshots()
    lanesDirtyRef.current = false
  }
  const markLanesDirty = () => {
    lanesDirtyRef.current = true
    if (animationFrame) return
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0
      refreshDirtyLanes()
    })
  }
  document.addEventListener('scroll', markLanesDirty, true)
  window.addEventListener('resize', markLanesDirty)
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(markLanesDirty)
  for (const lane of lanesRef.current) resizeObserver?.observe(lane.el)
  return () => {
    document.removeEventListener('scroll', markLanesDirty, true)
    window.removeEventListener('resize', markLanesDirty)
    resizeObserver?.disconnect()
    if (animationFrame) cancelAnimationFrame(animationFrame)
  }
}

// ---------------------------------------------------------------------------------------------
// Preview: each pointer frame places the bar without touching the store.

interface ReadPreviewDatesInput {
  bar: {
    allocation: Pick<Allocation, 'resourceId' | 'startDate' | 'endDate' | 'ignoreWorkingDays'>
  }
  calendar: GestureCalendar
  input: Pick<DragResizePreviewInput, 'mode' | 'deltaDays'>
  destination: Pick<LaneSnapshot, 'id'> | null
}

function readPreviewDates({ bar, calendar, input, destination }: ReadPreviewDatesInput) {
  const resourceId = bar.allocation.resourceId
  return buildGesturePreviewDates({
    allocation: bar.allocation,
    mode: input.mode,
    deltaDays: input.deltaDays,
    previewDays: resolveGestureWorkingDays(calendar, destination?.id ?? resourceId),
    sourceDays: destination ? resolveGestureWorkingDays(calendar, resourceId) : undefined,
    isReassignment: destination !== null,
  })
}

interface PreviewGestureInput {
  bar: BarLayout
  lanes: LaneSnapshot[]
  input: DragResizePreviewInput
}

function previewGesture({ bar, lanes, input }: PreviewGestureInput) {
  const resourceId = bar.allocation.resourceId
  const target =
    input.mode === 'move'
      ? resolveLaneAt(lanes, input.pointer.clientX, input.pointer.clientY)
      : null
  const destination = target && target.id !== resourceId ? target : null
  // Each frame reads the live calendar, so the preview and the commit judge the same data.
  const calendar = readGestureCalendar()
  const result = readPreviewDates({ bar, calendar, input, destination })
  // A refused reassignment previews the source-row range so the bar continues following horizontal movement without painting a destination placement that commit rejects.
  const blocked =
    input.mode === 'move' &&
    destination !== null &&
    (result.kind === 'blocked' ||
      (result.kind === 'ready' &&
        isDropStartBlocked({
          calendar,
          resourceId: destination.id,
          date: result.dates.startDate,
          ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
        })))
  const settled = blocked ? readPreviewDates({ bar, calendar, input, destination: null }) : result
  const preview: GesturePreview = {
    mode: input.mode,
    deltaDays: input.deltaDays,
    deltaY: input.deltaY,
    targetResourceId: target?.id ?? null,
    dates: settled.kind === 'ready' ? settled.dates : null,
  }
  if (input.mode !== 'move') return { preview, dropTarget: undefined }
  return { preview, dropTarget: destination && !blocked ? destination.el : null }
}

// ---------------------------------------------------------------------------------------------
// Commit: pointer release re-reads the store and saves one transaction.

interface ResolveCommitInput {
  subject: GestureSubject
  mode: DragMode
  deltaDays: number
  resourceId: ID
}

function resolveCommitDates({ subject, mode, deltaDays, resourceId }: ResolveCommitInput) {
  const { bar, isDays } = subject
  const source = bar.allocation.resourceId
  const calendar = readGestureCalendar()
  const workingDays = resolveGestureWorkingDays(calendar, resourceId)
  // A reassignment keeps the duration its origin measured; only the placement is the target's.
  const sourceWorkingDays =
    resourceId === source ? workingDays : resolveGestureWorkingDays(calendar, source)
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
  })
}

interface SavePointerCommitInput {
  bar: BarLayout
  targetResourceId: ID | null
  result: ReturnType<typeof resolveCommitDates>
}

async function savePointerCommit({ bar, targetResourceId, result }: SavePointerCommitInput) {
  const { setNotice, reassignAllocation, updateAllocation } = useStore.getState()
  let updated: Awaited<ReturnType<typeof updateAllocation>>
  try {
    updated = targetResourceId
      ? await reassignAllocation(bar.allocation.id, {
          ...result.dates,
          resourceId: targetResourceId,
        })
      : await updateAllocation(bar.allocation.id, {
          ...result.dates,
          ...(result.hours === bar.allocation.hoursPerDay ? null : { hoursPerDay: result.hours }),
        })
    if (!updated) return
  } catch (error) {
    // A diagonal drag is one transaction. A rejected reassignment must not commit its horizontal
    // component as a second update.
    if (isShownByPlanningState(error)) return
    setNotice(
      error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_rejected(),
      'error'
    )
    return
  }
  // The server measured the saved row; its advisory follows the reply.
  const advisory = updated.advisory ? formatCapacityAdvisory(updated.advisory, 'toast') : ''
  const dayCapacity = result.clamped ? m.scheduler_cap_fragment({ max: MAX_HOURS_PER_DAY }) : ''
  setNotice(
    `${targetResourceId ? m.scheduler_toast_reassigned() : m.scheduler_toast_moved()}${advisory}.${dayCapacity}${m.scheduler_toast_undo_hint({ shortcut: buildUndoShortcut() })}`,
    result.clamped ? 'warning' : 'info'
  )
}

interface PointerCommitInput {
  subject: GestureSubject
  mode: DragMode
  deltaDays: number
  target: LaneSnapshot | undefined | null
}

function commitPointerGesture({ subject, mode, deltaDays, target }: PointerCommitInput) {
  const { bar } = subject
  const resourceId = bar.allocation.resourceId
  const targetResourceId = target && target.id !== resourceId ? target.id : null
  if (deltaDays === 0 && !targetResourceId) return
  const effectiveResourceId = targetResourceId ?? resourceId
  if (refuseIneffectiveResize(bar, mode, effectiveResourceId)) return
  const result = resolveCommitDates({ subject, mode, deltaDays, resourceId: effectiveResourceId })
  if (
    targetResourceId &&
    isDropStartBlocked({
      calendar: readGestureCalendar(),
      resourceId: targetResourceId,
      date: result.dates.startDate,
      ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
    })
  ) {
    useStore.getState().setNotice(m.scheduler_toast_non_working_drop(), 'error')
    return
  }
  void savePointerCommit({ bar, targetResourceId, result })
}

// ---------------------------------------------------------------------------------------------
// Keyboard: a nudge skips the pointer protocol, saves, announces capacity and restores focus.

/** Focus action that locates an allocation within the active company. */
type ScheduleAllocationFocus = (allocationId: ID, companyId: ID | null) => void

// Reads the figures the store holds now; the caller checks they come from a read after the write.
function readCapacityAnnouncement(resourceId: ID): string {
  const { data, planning, ui } = useStore.getState()
  return buildCapacityAnnouncement({
    resources: data.resources,
    capacity: planning.capacity,
    resourceId,
    visibleRange: buildVisibleRange(ui),
  })
}

function resolveKeyboardGesture(bar: BarLayout, mode: DragMode, deltaDays: number) {
  const workingDays = resolveGestureWorkingDays(readGestureCalendar(), bar.allocation.resourceId)
  const gestureOptions = {
    ...(workingDays !== undefined ? { workingDays } : {}),
    ignoreWorkingDays: bar.allocation.ignoreWorkingDays,
  }
  const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
  const next = applyGesture({ mode, range: current, deltaDays, options: gestureOptions })
  return { current, next, gestureOptions }
}

interface KeyboardGestureCheckInput {
  current: DateRange
  next: DateRange
}

function refuseBlockedKeyboardGesture({ current, next }: KeyboardGestureCheckInput) {
  if (next.endDate < next.startDate) return true
  const state = useStore.getState()
  const visible = buildVisibleRange(state.ui)
  const leavesTimeline =
    hasRangeOverlap(current.startDate, current.endDate, visible.start, visible.end) &&
    !hasRangeOverlap(next.startDate, next.endDate, visible.start, visible.end)
  if (leavesTimeline) state.setNotice(m.scheduler_keyboard_outside_timeline(), 'error')
  return leavesTimeline
}

async function saveKeyboardGesture(
  bar: BarLayout,
  scheduleFocus: ScheduleAllocationFocus,
  input: { next: DateRange; rescale: ReturnType<typeof resolveVolumePreservingHours> | null }
) {
  const { next, rescale } = input
  const { activeCompanyId, setNotice, updateAllocation, announceCapacity } = useStore.getState()
  try {
    const updated = await updateAllocation(bar.allocation.id, {
      ...next,
      ...(rescale ? { hoursPerDay: rescale.hours } : null),
    })
    if (!updated) return
    if (rescale?.clamped) {
      setNotice(
        m.scheduler_toast_capped({ max: MAX_HOURS_PER_DAY, shortcut: buildUndoShortcut() }),
        'warning'
      )
    }
    // A cleared pending write means a read at or after its revision was accepted. Otherwise the
    // follow-up read, or the read that replaced it, failed; the figures may predate the write, and
    // nothing is said.
    if (useStore.getState().planning.phase.kind !== 'writing') {
      announceCapacity(readCapacityAnnouncement(bar.allocation.resourceId))
    }
    scheduleFocus(bar.allocation.id, activeCompanyId)
  } catch (error) {
    // Surface a refused gesture commit so preview feedback cannot imply that a rejected move saved.
    if (isShownByPlanningState(error)) return
    setNotice(
      error instanceof Error ? resolveErrorMessage(error) : m.scheduler_toast_move_disallowed(),
      'error'
    )
  }
}

function nudgeAllocation(
  subject: GestureSubject,
  scheduleFocus: ScheduleAllocationFocus,
  input: { mode: DragMode; deltaDays: number }
) {
  const { bar } = subject
  const { mode, deltaDays } = input
  if (refuseIneffectiveResize(bar, mode, bar.allocation.resourceId)) return
  const { current, next, gestureOptions } = resolveKeyboardGesture(bar, mode, deltaDays)
  if (refuseBlockedKeyboardGesture({ current, next })) return
  const rescale =
    subject.isDays && mode !== 'move'
      ? resolveVolumePreservingHours({
          previousDate: current,
          next,
          options: gestureOptions,
          hoursPerDay: bar.allocation.hoursPerDay,
        })
      : null
  const unchanged =
    next.startDate === current.startDate &&
    next.endDate === current.endDate &&
    (rescale === null || rescale.hours === bar.allocation.hoursPerDay)
  if (unchanged) return
  void saveKeyboardGesture(bar, scheduleFocus, { next, rescale })
}

/** Schedules focus for an allocation after its row becomes visible. */
function useAllocationFocus(): ScheduleAllocationFocus {
  const focusRafRef = useRef(0)
  useEffect(
    () => () => {
      if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current)
    },
    []
  )
  return (allocationId, companyId) => {
    if (focusRafRef.current) cancelAnimationFrame(focusRafRef.current)
    focusRafRef.current = requestAnimationFrame(() => {
      focusRafRef.current = 0
      if (useStore.getState().activeCompanyId !== companyId) return
      const element = Array.from(document.querySelectorAll<HTMLElement>('[data-alloc-id]')).find(
        (candidate) => candidate.dataset.allocId === allocationId
      )
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      element?.focus({ preventScroll: true })
    })
  }
}

// ---------------------------------------------------------------------------------------------

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
    resolveSchedulingMode(state.data, state.activeCompanyId)
  )
  const isDays = schedulingMode === 'days'
  const isBlocks = !hasHourlyLoad(schedulingMode)
  const subject: GestureSubject = { bar, isDays }
  const allocationId = bar.allocation.id

  const lanesRef = useRef<LaneSnapshot[]>([])
  const lanesDirtyRef = useRef(false)
  const dropElementRef = useRef<HTMLElement | null>(null)
  const stopWatchRef = useRef<(() => void) | null>(null)
  const stopGeometryWatch = () => {
    stopWatchRef.current?.()
    stopWatchRef.current = null
    lanesDirtyRef.current = false
  }
  const setDropTarget = (element: HTMLElement | null) => {
    if (dropElementRef.current === element) return
    dropElementRef.current?.removeAttribute('data-droptarget')
    element?.setAttribute('data-droptarget', '')
    dropElementRef.current = element
  }
  useEffect(
    () => () => {
      dropElementRef.current?.removeAttribute('data-droptarget')
      dropElementRef.current = null
      stopGeometryWatch()
      const store = useStore.getState()
      if (store.draggingAllocationId === allocationId) store.setDraggingAllocation(null)
    },
    [allocationId]
  )

  const [preview, setPreview] = useState<GesturePreview | null>(null)
  const scheduleFocus = useAllocationFocus()
  // Read store actions at call time because handlers commit against live state.
  const setDragging = (id: ID | null) => useStore.getState().setDraggingAllocation(id)
  const { onPointerDown: armPointerGesture } = useDragResize({
    indexAtClientX,
    onPreview: (input) => {
      if (!preview) setDragging(allocationId)
      const result = previewGesture({ bar, lanes: lanesRef.current, input })
      setPreview(result.preview)
      if (result.dropTarget !== undefined) setDropTarget(result.dropTarget)
    },
    onClick: () => {
      stopGeometryWatch()
      setDragging(null)
      onEdit?.(allocationId)
    },
    onCancel: () => {
      stopGeometryWatch()
      setDragging(null)
      setPreview(null)
      setDropTarget(null)
    },
    onCommit: (mode, deltaDays, pointer) => {
      setPreview(null)
      setDragging(null)
      // The final hit test is authoritative. Refresh move-lane geometry even if a scroll/resize
      // observer callback has not run yet, then stop its queued preview refresh.
      if (mode === 'move') lanesRef.current = readLaneSnapshots()
      stopGeometryWatch()
      const target =
        mode === 'move' ? resolveLaneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null
      setDropTarget(null)
      commitPointerGesture({ subject, mode, deltaDays, target })
    },
  })
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!armPointerGesture(event)) return
    lanesRef.current = readLaneSnapshots()
    stopGeometryWatch()
    stopWatchRef.current = watchLaneGeometry(lanesRef, lanesDirtyRef)
  }

  const { left, width, translateY } = buildGesturePreviewGeometry(bar, geometry, preview)

  return {
    isBlocks,
    dragging: preview !== null,
    left,
    width,
    translateY,
    onPointerDown,
    nudge: (mode: DragMode, delta: number) =>
      nudgeAllocation(subject, scheduleFocus, { mode, deltaDays: delta }),
  }
}
