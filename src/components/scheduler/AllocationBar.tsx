import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { m } from '@/i18n'
import { useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { useDragResize } from '../../hooks/useDragResize'
import { applyGesture, type DragMode } from '../../lib/gestureMath'
import { ensureBarColors } from '@capacitylens/shared/lib/color'
import { capacityAdvisory, capacityAllocationsForMode, dayCapacity } from '../../lib/capacity'
import { eachDayISO, parseDate } from '@capacitylens/shared/lib/dateMath'
import { schedulingModeFor, visibleRange } from '../../store/selectors'
import { allocationStatusLabels, resourceDisplayName } from '../../lib/metadata'
import { LAYOUT } from './layout'
import { computeGesture, reconcileReassignedHours, snappedBarGeometry, volumePreservingHoursClamped } from './allocationDrag'
import type { ColumnGeometry } from './columnGeometry'
import { isCapacityTracked, MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities'
import type { ID } from '@capacitylens/shared/types/entities'
import type { BarLayout } from './schedulerModel'

interface LaneSnapshot {
  id: string
  el: HTMLElement
  rect: DOMRect
}

/** Snapshot lane rects once at drag start — avoids a full-document querySelectorAll +
 *  getBoundingClientRect on every pointermove (layout thrash). Re-snapshotted on scroll. */
function snapshotLanes(): LaneSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-resource-id]')).map((el) => ({
    id: el.getAttribute('data-resource-id') ?? '',
    el,
    rect: el.getBoundingClientRect(),
  }))
}

/** Hours/day for display: days-mode rescaling can yield a repeating decimal
 *  (e.g. 24h over 7 working days = 3.4285…), so round to 2 dp for labels/popovers.
 *  The stored value stays exact; only what's shown is trimmed. */
const hoursLabel = (n: number) => Math.round(n * 100) / 100

/** Hit-test the drop point against the cached lane rects. */
function laneAt(lanes: LaneSnapshot[], clientX: number, clientY: number): LaneSnapshot | null {
  for (const l of lanes) {
    const r = l.rect
    if (clientY >= r.top && clientY <= r.bottom && clientX >= r.left && clientX <= r.right) return l
  }
  return null
}

/**
 * The screen-reader announcement for `resourceId`'s capacity AFTER a keyboard-committed edit
 * (WCAG 4.1.3). Reuses the EXACT per-day over-marker signal (`dayCapacity(...).over` — a day where
 * `allocated > available`, weekend-aware) so the spoken count matches the red over-cell, NOT the
 * visible-window utilisation % nor the fixed-14-day `overSoon` flag (the three signals stay
 * separate — see CLAUDE.md).
 *
 * The scan is clamped to the SAME visible timeline window the per-row sr-only summary counts over —
 * `visibleRange(ui)` = `[originDate .. originDate + rangeDays - 1]`, the very range SchedulerGrid
 * turns into `days` and `schedulerModel` turns into `dayStates`. The summary counts
 * `dayStates.filter(d => d.over)`, i.e. over-days only WITHIN that window, so the spoken count must
 * intersect the resource's allocation span with that window — otherwise an over-day scrolled OUT of
 * view would be spoken but not rendered, and the two would contradict. An external/capacity-free row
 * never reads as over. Reads the store imperatively at call time — pure given that snapshot.
 */
function capacityAnnouncement(resourceId: ID): string {
  const { data, ui } = useStore.getState()
  const resource = data.resources.find((r) => r.id === resourceId)
  // External parties carry no capacity — there is no over/under to report; speak nothing.
  if (!resource || !isCapacityTracked(resource)) return ''
  const name = resourceDisplayName(resource)
  const blocksMode = schedulingModeFor(data, useStore.getState().activeAccountId) === 'blocks'
  const allocs = capacityAllocationsForMode(
    data.allocations.filter((a) => a.resourceId === resourceId),
    blocksMode,
  )
  if (allocs.length === 0) return m.scheduler_sr_announce_clear({ name })
  // The over-marker spans every day the resource has work; bound the scan to that union extent…
  const timeOff = data.timeOff.filter((t) => t.resourceId === resourceId)
  let start = allocs[0]!.startDate
  let end = allocs[0]!.endDate
  for (const a of allocs) {
    if (a.startDate < start) start = a.startDate
    if (a.endDate > end) end = a.endDate
  }
  // …then CLAMP that span to the visible timeline window — the per-row sr-only summary counts over
  // `dayStates` (built across exactly this range), so an over-day outside the window is RENDERED-out
  // and must be SPOKEN-out too, or the count contradicts the row. ISO dates compare lexicographically.
  const { start: winStart, end: winEnd } = visibleRange(ui)
  if (start < winStart) start = winStart
  if (end > winEnd) end = winEnd
  // Empty intersection (the whole span sits outside the window): nothing visible is over → "clear".
  if (start > end) return m.scheduler_sr_announce_clear({ name })
  // SAME over rule the per-row sr-only summary and the red over-cell use (dayCapacity().over).
  const overDays = eachDayISO(start, end).reduce(
    (n, d) => n + (dayCapacity(resource, d, allocs, timeOff).over ? 1 : 0),
    0,
  )
  return overDays === 0
    ? m.scheduler_sr_announce_clear({ name })
    : overDays === 1
      ? m.scheduler_sr_announce_over_one({ name, count: overDays })
      : m.scheduler_sr_announce_over_other({ name, count: overDays })
}

/**
 * One draggable/resizable allocation bar in a resource lane.
 *
 * Gesture lifecycle (read this before touching the pointer handlers):
 * - **Armed on pointerdown.** `onPointerDown` only sets up side effects once `useDragResize`
 *   confirms the gesture is armed (left button, not re-entrant) — otherwise the scroll-watch and
 *   lane snapshot would leak with no commit/cancel/click to tear them down.
 * - **Side effects + teardown.** Arming takes a one-time `snapshotLanes()` (cached lane rects, to
 *   avoid per-move layout thrash) and starts a capture-phase scroll watcher that re-snapshots on
 *   scroll (a drop after a scroll would otherwise hit-test stale rects and reassign to the wrong
 *   row). Both are torn down on commit/cancel/click AND on unmount (the cleanup effect), so a bar
 *   removed mid-drag (undo, account switch, hot reload) can't leak the document scroll listener.
 * - **Drag-pin.** On the FIRST move we set the store's `draggingAllocationId` to this bar — that
 *   FREEZES SchedulerGrid's vertical virtualisation so a mid-gesture scroll can't unmount this bar
 *   and orphan the live drag. It's released on commit/cancel/click and, defensively, on unmount.
 * - **onEdit must be a STABLE ref.** The lane passes one callback for every bar; that referential
 *   stability is what lets `React.memo` skip re-rendering untouched bars during a sibling's drag.
 */
export const AllocationBar = memo(function AllocationBar({
  bar,
  geom,
  indexAtClientX,
  onEdit,
}: {
  bar: BarLayout
  // The column geometry the view-model used to place bar.x / bar.width — the live drag
  // preview goes back through it so a drag across a narrowed weekend doesn't jump on release.
  geom: ColumnGeometry
  // The lane's clientX→day-index resolver (live lane rect + geom), shared with the lane's
  // draw gesture so the bar's drag and the lane's draw use ONE inverse — never diverging
  // across narrow weekend columns.
  indexAtClientX: (clientX: number) => number
  // Takes the allocation id so the prop is a STABLE reference (the lane passes the
  // same callback for every bar) — which is what lets React.memo skip re-renders.
  // ABSENT for a Viewer (P1.12): the bar then renders display-only (no edit modal). The drag/resize
  // gating keys off `useCanEdit()` directly (below) so the hooks order stays stable across roles.
  onEdit?: (id: ID) => void
}) {
  // Viewer read-only (P1.12): a viewer bar is display-only — no drag/resize wiring, no resize grips,
  // no edit modal, no keyboard move. The popover (a read) still works. null/owner/admin/editor (incl.
  // OFF/local) → fully interactive, byte-identical to today. The server 403 backstops a write anyway.
  const canEdit = useCanEdit()
  const updateAllocation = useStore((s) => s.updateAllocation)
  const setNotice = useStore((s) => s.setNotice)
  // WCAG 4.1.3: announce the recomputed over-capacity outcome of a KEYBOARD edit to the grid's
  // polite aria-live region. Only the keyboard path (`nudge`) calls this — a pointer drag gives
  // sighted feedback, so announcing there would be redundant noise for everyone.
  const announceCapacity = useStore((s) => s.announceCapacity)
  const setDraggingAllocation = useStore((s) => s.setDraggingAllocation)
  // NB: the bar does NOT subscribe to the draw mode. In "Time off" mode the work bars must go
  // fully inert — not tab-stops, no hover popover, pointer events falling THROUGH to the lane so
  // you can draw time off across an existing allocation — but that `inert` is set ONCE on the
  // per-lane bars layer (ResourceLane's `<div inert>`), so toggling the mode is a single DOM write.
  // Subscribing here would re-render every mounted bar on every toggle; the layer-level inert gives
  // the same semantics for free. That toggle re-renders the bars layer but NOT this bar — primarily
  // because ResourceLane's props are stable, so its memo bails and BarsLayer re-renders alone,
  // handing this bar the same prop instances it already had. (This component being memoised AND
  // BarsLayer's props being stable is defense-in-depth that keeps the bail holding even if a future
  // change forced ResourceLane to re-render across a toggle — see BarsLayer's TSDoc.)
  // (The dim/glow re-skin is a separate, CSS-only flip driven by `data-draw-mode` on the grid — see
  // index.css.)
  const [preview, setPreview] = useState<{
    mode: DragMode
    deltaDays: number
    deltaY: number
    targetResourceId: ID | null
  } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const resourceId = bar.allocation.resourceId
  // The assignee's working days drive weekend-aware moves (extend across non-working
  // days to preserve working-day length), unless this allocation opts out.
  const workingDays = useStore((s) => s.data.resources.find((r) => r.id === resourceId)?.workingDays)
  // In days mode a resize preserves volume (days of work) by rescaling hours/day;
  // in hourly mode hours stay fixed and only the dates move.
  const isDays = useStore((s) => schedulingModeFor(s.data, s.activeAccountId) === 'days')
  // Blocks are pure bookings — the bar shows the activity name only, with no hours/load
  // surfaced on the label, accessible name, or popover.
  const isBlocks = useStore((s) => schedulingModeFor(s.data, s.activeAccountId) === 'blocks')
  // External / 3rd-party work carries no hours either (hoursPerDay 0); hide the load the same way
  // blocks do. The assignee's kind is already on the bar (from the model), so read it there rather
  // than re-scanning the store per render.
  const hideHours = isBlocks || bar.external
  const barLabelPrefs = useStore((s) => s.barLabelPrefs)
  // Hover/focus detail popover (real card, available to keyboard too — replaces the title tooltip).
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null)
  const showPopover = () => {
    const r = barRef.current?.getBoundingClientRect()
    if (r) setPop({ left: r.left, top: r.bottom + 6 })
  }
  const hidePopover = () => setPop(null)

  // Lane rects snapshotted at drag start; the drop highlight is toggled on just the
  // changed element (no per-move full-document query + class sweep).
  const lanesRef = useRef<LaneSnapshot[]>([])
  const dropElRef = useRef<HTMLElement | null>(null)
  const setDropTarget = (el: HTMLElement | null) => {
    if (dropElRef.current === el) return
    dropElRef.current?.removeAttribute('data-droptarget')
    el?.setAttribute('data-droptarget', '')
    dropElRef.current = el
  }

  // Keep the cached lane rects fresh if the grid scrolls mid-drag (scroll events
  // don't bubble, so listen in the capture phase). Otherwise a drop after a scroll
  // would hit-test against stale rects and reassign to the wrong row.
  const scrollWatchRef = useRef<(() => void) | null>(null)
  const startScrollWatch = () => {
    scrollWatchRef.current?.() // never stack watchers — tear down any prior one first
    // rAF-coalesce: scroll can fire many times per frame, and each re-snapshot is a
    // querySelectorAll + getBoundingClientRect over every lane — collapse to one per frame.
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
  const stopScrollWatch = () => {
    scrollWatchRef.current?.()
    scrollWatchRef.current = null
  }

  // Clear any drop highlight / scroll watch if this bar unmounts mid-drag (e.g. undo).
  useEffect(
    () => () => {
      dropElRef.current?.removeAttribute('data-droptarget')
      dropElRef.current = null
      stopScrollWatch()
      // If this bar still owned the drag-pin at unmount (deleted by another path, account
      // switch, hot reload), release it so the grid's virtual window can't stay frozen forever.
      const store = useStore.getState()
      if (store.draggingAllocationId === bar.allocation.id) store.setDraggingAllocation(null)
    },
    [bar.allocation.id],
  )

  const { onPointerDown } = useDragResize({
    indexAtClientX,
    onPreview: (mode, deltaDays, deltaY, pointer) => {
      // Pin this row on the FIRST move so a mid-gesture vertical scroll can't virtualise it
      // out of the DOM and tear down the document pointer listeners (losing the drag).
      if (!preview) setDraggingAllocation(bar.allocation.id)
      const target = mode === 'move' ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null
      setPreview({ mode, deltaDays, deltaY, targetResourceId: target?.id ?? null })
      if (mode === 'move') {
        setDropTarget(target && target.id !== resourceId ? target.el : null)
      }
    },
    onClick: () => {
      stopScrollWatch()
      setDraggingAllocation(null)
      onEdit?.(bar.allocation.id)
    },
    onCancel: () => {
      // Gesture cancelled (e.g. the browser stole the pointer to scroll) — abort cleanly.
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

      // Resolve the drop target FIRST: dropping on another resource's row reassigns.
      const target = mode === 'move' ? laneAt(lanesRef.current, pointer.clientX, pointer.clientY) : null
      const reassignTo = target && target.id !== resourceId ? target.id : null
      setDropTarget(null)
      if (deltaDays === 0 && !reassignTo) return

      // Snap dates against the resource the allocation will BELONG to (the TARGET on a
      // reassign, else the source) — otherwise a weekend-aware move snapped to one working
      // week is written against a resource with a different one and lands on its non-working
      // days. Reused below for the source-only fallback when a reassign is rejected.
      const computeFor = (rid: ID) => {
        const wd = rid === resourceId ? workingDays : useStore.getState().data.resources.find((r) => r.id === rid)?.workingDays
        // Days mode: a resize rescales hours/day to hold the work volume constant; a move keeps it.
        return computeGesture(
          mode,
          current,
          deltaDays,
          { workingDays: wd, ignoreWeekends: bar.allocation.ignoreWeekends },
          bar.allocation.hoursPerDay,
          isDays,
        )
      }

      const effResourceId = reassignTo ?? resourceId
      const { dates, hours, clamped } = computeFor(effResourceId)
      // On a REASSIGN, reconcile the load with the TARGET's kind: an external carries no hours (0),
      // and a real resource must carry > 0 — otherwise dragging a 0-hour external booking onto a
      // person would persist an illegal 0-hour allocation (the modal rejects it, and it under-counts
      // their utilisation), and dragging a person's work onto an external would leave a non-zero load
      // on a capacity-free row. A same-resource move keeps its hours untouched.
      const targetResource = reassignTo ? useStore.getState().data.resources.find((r) => r.id === reassignTo) : undefined
      const reconciledHours = targetResource ? reconcileReassignedHours(hours, targetResource) : hours
      const hoursPatch = reconciledHours !== bar.allocation.hoursPerDay ? { hoursPerDay: reconciledHours } : null
      try {
        updateAllocation(bar.allocation.id, {
          ...dates,
          ...hoursPatch,
          ...(reassignTo ? { resourceId: reassignTo } : {}),
        })
        // Confirm the commit + advertise undo, and run the SAME capacity advisory the modal
        // shows — against the resource it now belongs to. Read the store imperatively
        // (getState, not a subscription) so this stays off the bar's render/memo path.
        const { data } = useStore.getState()
        const resource = data.resources.find((r) => r.id === effResourceId)
        let advisory = ''
        // External parties have no capacity — skip the over-capacity / time-off advisory for them.
        if (resource && isCapacityTracked(resource)) {
          const others = capacityAllocationsForMode(
            data.allocations.filter((a) => a.resourceId === effResourceId && a.id !== bar.allocation.id),
            isBlocks,
          )
          const overTimeOff = data.timeOff.filter((t) => t.resourceId === effResourceId)
          const { overDays, timeOffDays } = capacityAdvisory(resource, others, overTimeOff, dates.startDate, dates.endDate, isBlocks ? 0 : reconciledHours, bar.allocation.ignoreWeekends)
          const bits: string[] = []
          if (overDays) bits.push(overDays === 1 ? m.scheduler_advisory_over_one({ count: overDays }) : m.scheduler_advisory_over_other({ count: overDays }))
          if (timeOffDays) bits.push(timeOffDays === 1 ? m.scheduler_advisory_timeoff_one({ count: timeOffDays }) : m.scheduler_advisory_timeoff_other({ count: timeOffDays }))
          if (bits.length) advisory = m.scheduler_advisory_prefix({ bits: bits.join(m.scheduler_advisory_join()) })
        }
        // A volume-preserving (days-mode) resize that shrank the span past the cap truncates
        // work: the derived hours/day exceeded MAX_HOURS_PER_DAY and were clamped, so the bar
        // now shows the capped figure with no other signal of the loss. Surface it on the SAME
        // post-commit toast the modal mirrors. A clamp can only arise on a resize (computeGesture
        // rescales only when mode !== 'move'), and reconcile only changes hours on a reassign,
        // which only happens on a move — so on any clamped path reconciledHours === hours; the
        // `clamped` flag alone is the signal.
        const cap = clamped ? m.scheduler_cap_fragment({ max: MAX_HOURS_PER_DAY }) : ''
        // A clamp truncated work (silent data loss), so this confirmation must NOT auto-dismiss on
        // the fixed 4s info timer — it's the sole signal of the loss (WCAG 2.2.1). Raise the SAME
        // (single) toast to 'warning' so it persists with a close affordance; an unclamped move/
        // reassign stays a transient 'info' confirmation.
        setNotice(
          `${reassignTo ? m.scheduler_toast_reassigned() : m.scheduler_toast_moved()}${advisory}.${cap}${m.scheduler_toast_undo_hint()}`,
          clamped ? 'warning' : 'info',
        )
      } catch (e) {
        // Reassignment rejected (e.g. a placeholder bound to another project): keep the
        // allocation on its source resource and apply just the date move, recomputed against
        // the SOURCE working week (the target's no longer applies). The store now re-validates
        // the merged row, so this source-only write can ITSELF throw on a genuinely-invalid row
        // (e.g. a cross-project placeholder). Guard it so the throw can't escape the gesture
        // handler — leave the bar where it was and surface it the same non-blocking way as the
        // primary failure below, rather than letting an uncaught error crash the drag.
        if (deltaDays !== 0) {
          try {
            const src = computeFor(resourceId)
            const srcPatch = src.hours !== bar.allocation.hoursPerDay ? { hoursPerDay: src.hours } : null
            updateAllocation(bar.allocation.id, { ...src.dates, ...srcPatch })
          } catch (fallbackError) {
            const primary = e instanceof Error ? e.message : m.scheduler_toast_move_rejected()
            const fallback = fallbackError instanceof Error ? fallbackError.message : m.scheduler_toast_move_failed()
            setNotice(`${primary} ${fallback}`, 'error')
            return
          }
        }
        setNotice(e instanceof Error ? e.message : m.scheduler_toast_move_rejected(), 'error')
      }
    },
  })

  let left = bar.x
  let width = bar.width
  let translateY = 0
  if (preview) {
    if (preview.mode === 'move') translateY = preview.deltaY
    if (preview.deltaDays !== 0) {
      // Preview the SAME working-day-snapped result the COMMIT will apply, so the bar doesn't
      // jump on release (the old raw calendar-shift preview diverged from the weekend-aware
      // commit). snappedBarGeometry runs the snapped dates through the SAME ColumnGeometry the
      // model used to place bar.x / bar.width — so the preview is pixel-identical even when the
      // range crosses a narrowed weekend.
      const cur = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
      const previewWorkingDays = preview.targetResourceId && preview.targetResourceId !== resourceId
        ? useStore.getState().data.resources.find((resource) => resource.id === preview.targetResourceId)?.workingDays
        : workingDays
      const geo = snappedBarGeometry(
        preview.mode,
        cur,
        preview.deltaDays,
        { workingDays: previewWorkingDays, ignoreWeekends: bar.allocation.ignoreWeekends },
        geom,
      )
      left = geo.left
      width = geo.width
    }
  }

  // Inset the bar by a few px on each side so it sits inside the day cell rather than flush
  // against the gridlines. Visual only — drag/resize deltas come from the pointer, not these
  // styled coords. Cap the inset to a third of the width so a single-day bar at tight zoom
  // stays visible and CENTRED, instead of a fixed inset collapsing it to a 1px sliver shoved
  // to one side (when dayWidth approaches 2·barInset).
  const inset = Math.min(LAYOUT.barInset, width / 3)
  const insetLeft = left + inset
  const insetWidth = Math.max(1, width - inset * 2)

  const dragging = preview !== null
  const tentative = bar.allocation.status === 'tentative'
  const completed = bar.allocation.status === 'completed'
  // Nudge the bar colour so the label clears WCAG AA against its ink (many mid-tones don't).
  // Memoised on the colour: the 0–30-iteration contrast loop must not re-run on every render.
  // bar.color is always a valid preset hex — resolveBarColor (schedulerModel) returns a preset
  // or discipline-derived swatch, never a user-typed hex ("preset swatches only" invariant) — so
  // the contrast loop is bounded (a malformed hex couldn't send it off the WCAG-step rails).
  const { bg, ink } = useMemo(() => ensureBarColors(bar.color), [bar.color])

  // Keyboard equivalent of drag: ←/→ move a day, Shift+←/→ resize the end a day.
  const nudge = (mode: DragMode, delta: number) => {
    const opts = { workingDays, ignoreWeekends: bar.allocation.ignoreWeekends }
    const current = { startDate: bar.allocation.startDate, endDate: bar.allocation.endDate }
    const next = applyGesture(mode, current, delta, opts)
    if (next.endDate < next.startDate) return
    // Match the pointer path: a days-mode resize rescales hours to preserve volume, and a
    // resize that shrinks the span past the cap clamps the derived hours/day (truncating work).
    const rescale = isDays && mode !== 'move' ? volumePreservingHoursClamped(current, next, opts, bar.allocation.hoursPerDay) : null
    const hoursPatch = rescale ? { hoursPerDay: rescale.hours } : null
    try {
      updateAllocation(bar.allocation.id, { ...next, ...hoursPatch })
      // Surface a clamp the same non-blocking way the pointer commit does — the bar would
      // otherwise just show the capped figure with no hint the volume was truncated. This toast is
      // raised ONLY on a clamp, so it always reports silent data loss: tone 'warning' so it persists
      // with a close affordance instead of auto-dismissing on the fixed 4s timer (WCAG 2.2.1).
      if (rescale?.clamped) setNotice(m.scheduler_toast_capped({ max: MAX_HOURS_PER_DAY }), 'warning')
      // WCAG 4.1.3 (Status Messages): a keyboard nudge can flip a day to over-capacity, but the
      // per-row sr-only over-capacity summary mutates SILENTLY while focus stays on this bar — a
      // screen-reader user gets no feedback that their own edit changed capacity. Announce the
      // recomputed outcome for the affected resource via the grid's polite aria-live region.
      // Read the store imperatively (getState, not a subscription) so this stays off the render
      // path, exactly like the pointer commit's advisory. A keyboard nudge never reassigns rows,
      // so the affected resource is always this bar's own `resourceId`.
      announceCapacity(capacityAnnouncement(resourceId))
    } catch (e) {
      // Integrity rejected the keyboard move/resize (e.g. into an illegal slot). Surface it the
      // same way the pointer-drag commit path does (onCommit above) — a silent no-op left the bar
      // sitting still with no hint why, which reads as a broken key.
      setNotice(e instanceof Error ? e.message : m.scheduler_toast_move_disallowed(), 'error')
    }
  }

  // Client · Project context ahead of the activity name, per the device-global display
  // toggles. A bar without the metadata (e.g. a general activity with no project) skips
  // those parts. The popover keeps its own project/client line, so it stays activity-first.
  const labelText = [
    barLabelPrefs.showClient ? bar.client : undefined,
    barLabelPrefs.showProject ? bar.project : undefined,
    bar.label,
  ]
    .filter(Boolean)
    .join(' · ')

  const fmt = (d: string) => format(parseDate(d), 'd MMM')
  const gripClass = 'group/grip absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center'
  const gripLine = <span aria-hidden className="pointer-events-none h-4 w-0.5 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-60" />

  return (
    <>
      <div
        ref={barRef}
        data-testid="allocation-bar"
        data-alloc-id={bar.allocation.id}
        data-status={bar.allocation.status}
        // Viewer (P1.12): a read-only bar is NOT an edit button — role="img" + a description-only
        // aria-label, no tab stop, no edit/move keys, no drag pointerdown. It still shows its hover/
        // focus popover (a read). An editor keeps the full interactive button semantics below.
        role={canEdit ? 'button' : 'img'}
        tabIndex={canEdit ? 0 : undefined}
        aria-label={
          canEdit
            ? m.scheduler_bar_aria_editor({
                label: labelText,
                hours: hideHours ? '' : m.scheduler_bar_aria_hours({ hours: hoursLabel(bar.allocation.hoursPerDay) }),
                // Speak the HUMANISED status + 'd MMM' dates the popover already shows — a SR must hear
                // "Tentative … 1 Jun to 5 Jun", not the raw enum + ISO ("tentative … 2026-06-01").
                status: allocationStatusLabels()[bar.allocation.status],
                start: fmt(bar.allocation.startDate),
                end: fmt(bar.allocation.endDate),
                // The visible "•" note dot (below) is otherwise lost to AT; surface its PRESENCE here
                // (the note CONTENT lives in the edit modal). Empty when there's no note.
                note: bar.allocation.note ? m.scheduler_bar_aria_has_note() : '',
              })
            : m.scheduler_bar_aria_viewer({
                label: labelText,
                hours: hideHours ? '' : m.scheduler_bar_aria_hours({ hours: hoursLabel(bar.allocation.hoursPerDay) }),
                status: allocationStatusLabels()[bar.allocation.status],
                start: fmt(bar.allocation.startDate),
                end: fmt(bar.allocation.endDate),
                note: bar.allocation.note ? m.scheduler_bar_aria_has_note() : '',
              })
        }
        onPointerDown={
          canEdit
            ? (e) => {
                hidePopover()
                // Only snapshot lanes + watch scroll once the gesture is actually armed.
                // An ignored pointerdown (non-left button / re-entrant) has no
                // onCommit/onCancel/onClick to stop the scroll watcher, so starting it
                // here would leak the document scroll listener until unmount.
                if (!onPointerDown(e)) return
                lanesRef.current = snapshotLanes()
                startScrollWatch()
              }
            : undefined
        }
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        onFocus={showPopover}
        onBlur={hidePopover}
        onKeyDown={
          canEdit
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onEdit?.(bar.allocation.id)
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  // Alt = resize the start edge, Shift = resize the end edge, neither = move.
                  const mode = e.altKey ? 'resize-start' : e.shiftKey ? 'resize-end' : 'move'
                  nudge(mode, e.key === 'ArrowRight' ? 1 : -1)
                }
              }
            : undefined
        }
        // `scheduler-bar` is the semantic hook for BOTH the time-off draw-mode recede AND the
        // focus indicator (index.css `.scheduler-bar:focus-visible`); the app styles by this class,
        // NOT by `data-testid` (which stays test-only selection). The focus indicator is a DUAL-TONE
        // ring (WCAG 1.4.11): a single edge can't pass because the over-capacity cell is a PALE rose
        // in light (needs a dark edge) but a DEEP red in dark (needs a light edge) — opposite
        // requirements — so a near-black + near-white pair straddles the bar's outer border, and at
        // least one always clears 3:1 against any adjacency in both themes. See the CSS rule + the
        // pinned regression in src/lib/color.test.ts. Defined in CSS (not Tailwind utilities here); on
        // focus this box-shadow overrides the resting `ring-1 ring-black/5` (intentional — the bold focus
        // ring replaces the faint resting ring while focused).
        className={`scheduler-bar group absolute flex select-none items-center overflow-hidden rounded-md text-xs font-medium shadow-sm ring-1 ring-black/5 transition-[box-shadow,transform] hover:shadow-md ${dragging ? 'shadow-lg ring-black/10' : ''}`}
        style={{
          left: insetLeft,
          width: insetWidth,
          top: bar.top,
          height: LAYOUT.barHeight,
          backgroundColor: bg,
          color: ink,
          // Tentative is signalled by the dashed border + hatch overlay below — NOT by
          // element opacity, which used to wash out the label and break its contrast.
          border: tentative ? `1px dashed ${ink}` : undefined,
          transform: translateY ? `translateY(${translateY}px)` : undefined,
          zIndex: dragging ? 50 : undefined,
          // WCAG 2.4.11 (Focus Not Obscured): on focus the browser scrolls this bar into view, but
          // the grid's sticky date header (top, z-20) and sticky utilisation column (left, z-30)
          // overlap the scroll viewport — without a margin a near-edge bar lands fully behind them.
          // scroll-margin reserves the sticky chrome's footprint so scroll-into-view stops the
          // focused bar clear of both.
          // - TOP: the date header is a TWO-TIER header whose REAL rendered height (~51px at zoom 4,
          //   ~67px at zoom 2, more at a larger font size) exceeds LAYOUT.headerHeight (44 — only a
          //   min-height floor). So we track the height SchedulerGrid measures and publishes as
          //   --sched-sticky-top (44px fallback before the first measure / in jsdom), NOT the
          //   constant, or a near-top bar would land partly behind the header.
          // - LEFT: the utilisation column is a genuine compile-time width (LAYOUT.leftColWidth),
          //   so the constant is exact here.
          scrollMarginTop: 'var(--sched-sticky-top, 44px)',
          scrollMarginLeft: LAYOUT.leftColWidth,
          // Viewer (P1.12): a display-only bar shows the default cursor (nothing to grab) and lets
          // touch-scroll through (no drag to win over it).
          cursor: !canEdit ? 'default' : dragging ? 'grabbing' : 'grab',
          touchAction: canEdit ? 'none' : undefined, // editor: bar drag/resize should win over touch-scroll
        }}
      >
        {/* Resize grips: editor-only (P1.12) — a viewer bar has no resize affordance. */}
        {canEdit && (
        <span data-handle="start" data-testid="resize-start" className={`left-0 ${gripClass}`}>
          {gripLine}
        </span>
        )}
        {tentative && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'repeating-linear-gradient(45deg, color-mix(in oklab, currentColor 16%, transparent) 0 4px, transparent 4px 8px)' }}
          />
        )}
        <span className="truncate px-2.5">
          {completed ? '✓ ' : ''}
          {labelText}
          {hideHours ? '' : m.scheduler_bar_hours_suffix({ hours: hoursLabel(bar.allocation.hoursPerDay) })}
          {bar.allocation.note ? ' •' : ''}
        </span>
        {canEdit && (
        <span data-handle="end" data-testid="resize-end" className={`right-0 ${gripClass}`}>
          {gripLine}
        </span>
        )}
      </div>

      {pop &&
        !dragging &&
        // No `inert` guard here: the bar layer goes inert in time-off mode, which BLOCKS the
        // mouseenter/focus that opens a popover — so a NEW one can't appear while inert. The only
        // residual case is a popover already open at the instant of toggle; that's unreachable in
        // practice (any path to the Time-off toggle blurs/leaves the bar first, firing hidePopover),
        // and the portaled popover sits OUTSIDE the inert layer, so a CSS net in index.css
        // (`[data-draw-mode] :has` rule) hides it defensively without re-subscribing every bar.
        createPortal(
          <div
            data-testid="allocation-popover"
            aria-hidden
            // `scheduler-alloc-popover` is the semantic hook the time-off draw-mode net hides
            // (index.css `:has()` rule), keyed by class — not by `data-testid` (test-only).
            className="scheduler-alloc-popover pointer-events-none fixed z-[60] w-60 rounded-lg bg-elevated p-3 text-xs text-ink shadow-pop ring-1 ring-line"
            style={{ left: pop.left, top: pop.top }}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: bg }} />
              <span className="font-semibold">{bar.label}</span>
            </div>
            {(bar.project || bar.client) && (
              <div className="mb-1 text-muted">
                {bar.project}
                {bar.project && bar.client ? ' · ' : ''}
                {bar.client}
              </div>
            )}
            <div className="text-muted">
              {fmt(bar.allocation.startDate)} – {fmt(bar.allocation.endDate)}
              {hideHours ? '' : m.scheduler_bar_pop_hours({ hours: hoursLabel(bar.allocation.hoursPerDay) })} · {allocationStatusLabels()[bar.allocation.status]}
            </div>
            {bar.allocation.note && <div className="mt-1 border-t border-line pt-1 text-muted">{bar.allocation.note}</div>}
            <div className="mt-1 border-t border-line pt-1 text-2xs text-faint">
              {m.scheduler_bar_pop_footer()}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
})
