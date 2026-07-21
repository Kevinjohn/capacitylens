import { memo, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { m } from '@/i18n'
import { useStore } from '../../store/useStore'
import { useCanEdit } from '../../auth/permissionContext'
import { ensureBarColors } from '@capacitylens/shared/lib/color'
import { parseDate } from '@capacitylens/shared/lib/dateMath'
import { allocationStatusLabels } from '../../lib/metadata'
import { LAYOUT } from './layout'
import type { ColumnGeometry } from './columnGeometry'
import type { ID } from '@capacitylens/shared/types/entities'
import type { BarLayout } from './schedulerModel'
import { useAllocationGesture } from './useAllocationGesture'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** Hours/day for display: days-mode rescaling can yield a repeating decimal
 *  (e.g. 24h over 7 working days = 3.4285…), so round to 2 dp for labels/popovers.
 *  The stored value stays exact; only what's shown is trimmed. */
const hoursLabel = (n: number) => Math.round(n * 100) / 100


/**
 * One draggable/resizable allocation bar in a resource lane.
 *
 * Gesture lifecycle (read this before touching the pointer handlers):
 * - **Armed on pointerdown.** The gesture controller only sets up side effects once its drag hook
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
  const { isBlocks, dragging, left, width, translateY, onPointerDown, nudge } =
    useAllocationGesture({ bar, geom, indexAtClientX, onEdit })
  // External / 3rd-party work carries no hours either (hoursPerDay 0); hide the load the same way
  // blocks do. The assignee's kind is already on the bar (from the model), so read it there rather
  // than re-scanning the store per render.
  const hideHours = isBlocks || bar.external
  const barLabelPrefs = useStore((s) => s.barLabelPrefs)
  // Hover/focus detail popover (real card, available to keyboard too — replaces the title tooltip).
  // Radix Tooltip owns positioning/collision/portal-layering now; we only own the open flag so the
  // exact open-on-enter/focus, close-on-leave/blur behaviour (and the drag suppression below) is
  // preserved. Open is gated on `!dragging` at render (Radix `open` prop) so a popover never shows
  // mid-drag, and the pointerdown that starts a drag also calls hidePopover() first.
  const [popoverOpen, setPopoverOpen] = useState(false)
  const showPopover = () => setPopoverOpen(true)
  const hidePopover = () => setPopoverOpen(false)

  // Inset the bar by a few px on each side so it sits inside the day cell rather than flush
  // against the gridlines. Visual only — drag/resize deltas come from the pointer, not these
  // styled coords. Cap the inset to a third of the width so a single-day bar at tight zoom
  // stays visible and CENTRED, instead of a fixed inset collapsing it to a 1px sliver shoved
  // to one side (when dayWidth approaches 2·barInset).
  const inset = Math.min(LAYOUT.barInset, width / 3)
  const insetLeft = left + inset
  const insetWidth = Math.max(1, width - inset * 2)

  const tentative = bar.allocation.status === 'tentative'
  const completed = bar.allocation.status === 'completed'
  // Nudge the bar colour so the label clears WCAG AA against its ink (many mid-tones don't).
  // Memoised on the colour: the 0–30-iteration contrast loop must not re-run on every render.
  // bar.color is always a valid preset hex — resolveBarColor (schedulerModel) returns a preset
  // or discipline-derived swatch, never a user-typed hex ("preset swatches only" invariant) — so
  // the contrast loop is bounded (a malformed hex couldn't send it off the WCAG-step rails).
  const { bg, ink } = useMemo(() => ensureBarColors(bar.color), [bar.color])

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
    // Radix Tooltip: controlled `open` so we keep the hand-tuned enter/focus/leave/blur behaviour
    // AND the drag suppression, while positioning, collision-flipping and body-portal layering come
    // from Radix instead of getBoundingClientRect + fixed inline coords. The bar div IS the trigger
    // (asChild), so its data-testid / data-alloc-id / role / aria-label are untouched.
    <Tooltip open={popoverOpen && !dragging} onOpenChange={(o) => { if (!dragging) setPopoverOpen(o) }}>
      <TooltipTrigger asChild>
      <div
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
                onPointerDown(e)
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
      </TooltipTrigger>
      {/* Radix portals this to <body> (TooltipPrimitive.Portal), so the time-off draw-mode net in
          index.css (`body:has([data-draw-mode="timeoff"]) .scheduler-alloc-popover`) still matches —
          it's keyed off the `.scheduler-alloc-popover` class (a body descendant), not the DOM nesting.
          Belt-and-braces with the bar-layer `inert` (which blocks the enter/focus that opens it) and
          the `!dragging` open gate above. `aria-hidden`: the trigger's own aria-label already speaks
          the humanised status/dates/note, so the tooltip stays a purely visual read (no double SR
          announcement). Side/align/offset reproduce the old below-the-bar, left-aligned placement. */}
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={6}
        data-testid="allocation-popover"
        aria-hidden
        className="scheduler-alloc-popover pointer-events-none w-60 rounded-lg p-3 font-normal"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: bg }} />
          <span className="font-semibold">{bar.label}</span>
        </div>
        {(bar.project || bar.client) && (
          <div className="mb-1 text-muted-foreground">
            {bar.project}
            {bar.project && bar.client ? ' · ' : ''}
            {bar.client}
          </div>
        )}
        <div className="text-muted-foreground">
          {fmt(bar.allocation.startDate)} – {fmt(bar.allocation.endDate)}
          {hideHours ? '' : m.scheduler_bar_pop_hours({ hours: hoursLabel(bar.allocation.hoursPerDay) })} · {allocationStatusLabels()[bar.allocation.status]}
        </div>
        {bar.allocation.note && <div className="mt-1 border-t border-line pt-1 text-muted-foreground">{bar.allocation.note}</div>}
        <div className="mt-1 border-t border-line pt-1 text-2xs text-faint">
          {m.scheduler_bar_pop_footer()}
        </div>
      </TooltipContent>
    </Tooltip>
  )
})
