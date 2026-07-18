import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { m } from '@/i18n'
import { applyGesture, type DragMode } from '../../lib/gestureMath'
import { capacityAdvisory, capacityAllocationsForMode, dayCapacity } from '../../lib/capacity'
import { eachDayISO } from '@capacitylens/shared/lib/dateMath'
import { isCapacityTracked, MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities'
import type { ID } from '@capacitylens/shared/types/entities'
import { useDragResize } from '../../hooks/useDragResize'
import { resourceDisplayName } from '../../lib/metadata'
import { schedulingModeFor, visibleRange } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import {
  computeGesture,
  reconcileReassignedHours,
  snappedBarGeometry,
  volumePreservingHoursClamped,
} from './allocationDrag'
import type { ColumnGeometry } from './columnGeometry'
import type { BarLayout } from './schedulerModel'

interface LaneSnapshot {
  id: string
  el: HTMLElement
  rect: DOMRect
}

interface GesturePreview {
  mode: DragMode
  deltaDays: number
  deltaY: number
  targetResourceId: ID | null
}

function snapshotLanes(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-resource-id]')).map((el) => ({
    id: el.getAttribute('data-resource-id') ?? '',
    el,
    rect: el.getBoundingClientRect(),
  }))
}

function laneAt(lanes: LaneSnapshot[], clientX: number, clientY: number): LaneSnapshot | null {
  for (const lane of lanes) {
    const { rect } = lane
    if (clientY >= rect.top && clientY <= rect.bottom && clientX >= rect.left && clientX <= rect.right) {
      return lane
    }
  }
  return null
}

/** Builds the screen-reader status from the same visible-range capacity signal as the grid. */
function capacityAnnouncement(resourceId: ID): string {
  const { data, ui, activeAccountId } = useStore.getState()
  const resource = data.resources.find((candidate) => candidate.id === resourceId)
  if (!resource || !isCapacityTracked(resource)) return ''

  const name = resourceDisplayName(resource)
  const blocksMode = schedulingModeFor(data, activeAccountId) === 'blocks'
  const allocations = capacityAllocationsForMode(
    data.allocations.filter((allocation) => allocation.resourceId === resourceId),
    blocksMode,
  )
  if (allocations.length === 0) return m.scheduler_sr_announce_clear({ name })

  let start = allocations[0]!.startDate
  let end = allocations[0]!.endDate
  for (const allocation of allocations) {
    if (allocation.startDate < start) start = allocation.startDate
    if (allocation.endDate > end) end = allocation.endDate
  }
  const visible = visibleRange(ui)
  if (start < visible.start) start = visible.start
  if (end > visible.end) end = visible.end
  if (start > end) return m.scheduler_sr_announce_clear({ name })

  const timeOff = data.timeOff.filter((entry) => entry.resourceId === resourceId)
  const overDays = eachDayISO(start, end).reduce(
    (count, date) => count + (dayCapacity(resource, date, allocations, timeOff).over ? 1 : 0),
    0,
  )
  if (overDays === 0) return m.scheduler_sr_announce_clear({ name })
  return overDays === 1
    ? m.scheduler_sr_announce_over_one({ name, count: overDays })
    : m.scheduler_sr_announce_over_other({ name, count: overDays })
}

interface AllocationGestureOptions {
  bar: BarLayout
  geom: ColumnGeometry
  indexAtClientX: (clientX: number) => number
  onEdit?: (id: ID) => void
}

/**
 * Coordinates the complete allocation gesture lifecycle, including lane hit-testing,
 * drag pinning, weekend-aware previews, reassignment reconciliation and keyboard parity.
 */
export function useAllocationGesture({ bar, geom, indexAtClientX, onEdit }: AllocationGestureOptions) {
  const updateAllocation = useStore((state) => state.updateAllocation)
  const setNotice = useStore((state) => state.setNotice)
  const announceCapacity = useStore((state) => state.announceCapacity)
  const setDraggingAllocation = useStore((state) => state.setDraggingAllocation)
  const resourceId = bar.allocation.resourceId
  const workingDays = useStore(
    (state) => state.data.resources.find((resource) => resource.id === resourceId)?.workingDays,
  )
  const schedulingMode = useStore((state) => schedulingModeFor(state.data, state.activeAccountId))
  const isDays = schedulingMode === 'days'
  const isBlocks = schedulingMode === 'blocks'
  const [preview, setPreview] = useState<GesturePreview | null>(null)
  const lanesRef = useRef<LaneSnapshot[]>([])
  const dropElRef = useRef<HTMLElement | null>(null)
  const scrollWatchRef = useRef<(() => void) | null>(null)

  const setDropTarget = (el: HTMLElement | null) => {
    if (dropElRef.current === el) return
    dropElRef.current?.removeAttribute('data-droptarget')
    el?.setAttribute('data-droptarget', '')
    dropElRef.current = el
  }

  const stopScrollWatch = () => {
    scrollWatchRef.current?.()
    scrollWatchRef.current = null
  }

  const startScrollWatch = () => {
    stopScrollWatch()
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        lanesRef.current = snapshotLanes()
      })
    }
    document.addEventListener('scroll', onScroll, true)
    scrollWatchRef.current = () => {
      document.removeEventListener('scroll', onScroll, true)
      if (raf) cancelAnimationFrame(raf)
    }
  }

  useEffect(
    () => () => {
      dropElRef.current?.removeAttribute('data-droptarget')
      dropElRef.current = null
      stopScrollWatch()
      const store = useStore.getState()
      if (store.draggingAllocationId === bar.allocation.id) store.setDraggingAllocation(null)
    },
    [bar.allocation.id],
  )

  const { onPointerDown: armPointerGesture } = useDragResize({
    indexAtClientX,
    onPreview: (mode, deltaDays, deltaY, pointer) => {
      if (!preview) setDraggingAllocation(bar.allocation.id)
      const target = mode === 'move' ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null
      setPreview({ mode, deltaDays, deltaY, targetResourceId: target?.id ?? null })
      if (mode === 'move') setDropTarget(target && target.id !== resourceId ? target.el : null)
    },
    onClick: () => {
      stopScrollWatch()
      setDraggingAllocation(null)
      onEdit?.(bar.allocation.id)
    },
    onCancel: () => {
      stopScrollWatch()
      setDraggingAllocation(null)
      setPreview(null)
      setDropTarget(null)
    },
    onCommit: (mode, deltaDays, pointer) => {
      stopScrollWatch()
      setPreview(null)
      setDraggingAllocation(null)
      const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
      const target = mode === 'move' ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null
      const reassignTo = target && target.id !== resourceId ? target.id : null
      setDropTarget(null)
      if (deltaDays === 0 && !reassignTo) return

      const computeFor = (targetResourceId: ID) => {
        const targetWorkingDays =
          targetResourceId === resourceId
            ? workingDays
            : useStore.getState().data.resources.find((resource) => resource.id === targetResourceId)
                ?.workingDays
        return computeGesture(
          mode,
          current,
          deltaDays,
          { workingDays: targetWorkingDays, ignoreWeekends: bar.allocation.ignoreWeekends },
          bar.allocation.hoursPerDay,
          isDays,
        )
      }

      const effectiveResourceId = reassignTo ?? resourceId
      const { dates, hours, clamped } = computeFor(effectiveResourceId)
      const targetResource = reassignTo
        ? useStore.getState().data.resources.find((resource) => resource.id === reassignTo)
        : undefined
      const reconciledHours = targetResource ? reconcileReassignedHours(hours, targetResource) : hours
      const hoursPatch =
        reconciledHours !== bar.allocation.hoursPerDay ? { hoursPerDay: reconciledHours } : null

      try {
        updateAllocation(bar.allocation.id, {
          ...dates,
          ...hoursPatch,
          ...(reassignTo ? { resourceId: reassignTo } : {}),
        })
        const { data } = useStore.getState()
        const resource = data.resources.find((candidate) => candidate.id === effectiveResourceId)
        let advisory = ''
        if (resource && isCapacityTracked(resource)) {
          const others = capacityAllocationsForMode(
            data.allocations.filter(
              (allocation) =>
                allocation.resourceId === effectiveResourceId && allocation.id !== bar.allocation.id,
            ),
            isBlocks,
          )
          const timeOff = data.timeOff.filter((entry) => entry.resourceId === effectiveResourceId)
          const result = capacityAdvisory(
            resource,
            others,
            timeOff,
            dates.startDate,
            dates.endDate,
            isBlocks ? 0 : reconciledHours,
            bar.allocation.ignoreWeekends,
          )
          const bits: string[] = []
          if (result.overDays) {
            bits.push(
              result.overDays === 1
                ? m.scheduler_advisory_over_one({ count: result.overDays })
                : m.scheduler_advisory_over_other({ count: result.overDays }),
            )
          }
          if (result.timeOffDays) {
            bits.push(
              result.timeOffDays === 1
                ? m.scheduler_advisory_timeoff_one({ count: result.timeOffDays })
                : m.scheduler_advisory_timeoff_other({ count: result.timeOffDays }),
            )
          }
          if (bits.length) {
            advisory = m.scheduler_advisory_prefix({ bits: bits.join(m.scheduler_advisory_join()) })
          }
        }
        const cap = clamped ? m.scheduler_cap_fragment({ max: MAX_HOURS_PER_DAY }) : ''
        setNotice(
          `${reassignTo ? m.scheduler_toast_reassigned() : m.scheduler_toast_moved()}${advisory}.${cap}${m.scheduler_toast_undo_hint()}`,
          clamped ? 'warning' : 'info',
        )
      } catch (error) {
        if (deltaDays !== 0) {
          try {
            const source = computeFor(resourceId)
            const sourceHoursPatch =
              source.hours !== bar.allocation.hoursPerDay ? { hoursPerDay: source.hours } : null
            updateAllocation(bar.allocation.id, { ...source.dates, ...sourceHoursPatch })
          } catch (fallbackError) {
            const primary = error instanceof Error ? error.message : m.scheduler_toast_move_rejected()
            const fallback =
              fallbackError instanceof Error ? fallbackError.message : m.scheduler_toast_move_failed()
            setNotice(`${primary} ${fallback}`, 'error')
            return
          }
        }
        setNotice(error instanceof Error ? error.message : m.scheduler_toast_move_rejected(), 'error')
      }
    },
  })

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!armPointerGesture(event)) return
    lanesRef.current = snapshotLanes()
    startScrollWatch()
  }

  const nudge = (mode: DragMode, delta: number) => {
    const options = { workingDays, ignoreWeekends: bar.allocation.ignoreWeekends }
    const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
    const next = applyGesture(mode, current, delta, options)
    if (next.endDate < next.startDate) return
    const rescale =
      isDays && mode !== 'move'
        ? volumePreservingHoursClamped(current, next, options, bar.allocation.hoursPerDay)
        : null
    try {
      updateAllocation(bar.allocation.id, {
        ...next,
        ...(rescale ? { hoursPerDay: rescale.hours } : null),
      })
      if (rescale?.clamped) {
        setNotice(m.scheduler_toast_capped({ max: MAX_HOURS_PER_DAY }), 'warning')
      }
      announceCapacity(capacityAnnouncement(resourceId))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : m.scheduler_toast_move_disallowed(), 'error')
    }
  }

  let left = bar.x
  let width = bar.width
  let translateY = 0
  if (preview) {
    if (preview.mode === 'move') translateY = preview.deltaY
    if (preview.deltaDays !== 0) {
      const previewWorkingDays =
        preview.targetResourceId && preview.targetResourceId !== resourceId
          ? useStore.getState().data.resources.find(
              (resource) => resource.id === preview.targetResourceId,
            )?.workingDays
          : workingDays
      const geometry = snappedBarGeometry(
        preview.mode,
        { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate },
        preview.deltaDays,
        { workingDays: previewWorkingDays, ignoreWeekends: bar.allocation.ignoreWeekends },
        geom,
      )
      left = geometry.left
      width = geometry.width
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
  }
}
