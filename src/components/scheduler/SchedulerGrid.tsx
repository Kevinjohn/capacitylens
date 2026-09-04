import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, Users } from "lucide-react";
import { m } from "@/i18n";
import { useStore } from "../../store/useStore";
import { useCanEdit } from "../../auth/permissionContext";
import { sharedScopedData } from "../../store/useScopedData";
import { accountWorkingDaysFor } from "../../store/selectors";
import { EmptyState } from "../common/ui";
import { LAYOUT } from "./layout";
import { SchedulerGridHeader } from "./SchedulerGridHeader";
import { useSchedulerViewport } from "./useSchedulerViewport";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";
import { TooltipProvider } from "../ui/tooltip";
import { isCreationStartBlocked } from "./creationAvailability";
import { SchedulerGridRows } from "./SchedulerGridRows";
import type { ModalState } from "./schedulerGridModal";
import { useSchedulerGridPreferences, useSchedulerGridModel } from "./useSchedulerGridModel";
import { useSchedulerGridVirtualization } from "./useSchedulerGridVirtualization";

// Creation/editing forms are not needed to paint or inspect the schedule. Load them on the first
// interaction so their validation and picker dependencies do not consume the initial entry budget.
const AllocationModal = lazy(() =>
  import("./AllocationModal").then((module) => ({
    default: module.AllocationModal,
  })),
);
const TimeOffForm = lazy(() =>
  import("../timeoff/TimeOffForm").then((module) => ({
    default: module.TimeOffForm,
  })),
);

export function SchedulerGrid() {
  const navigate = useNavigate();
  const prefs = useSchedulerGridPreferences();
  const {
    data,
    accountPrefs: { calendarWeekStartsOn },
    ui,
    utilizationPrefs,
    minimiseWeekends,
    snapToWeekStart,
  } = prefs;
  // Viewer read-only (P1.12): when the active account's role is a viewer, the grid is display-only —
  // no row "+" create, no lane draw-to-create, no bar edit/drag/resize (the bar gating lives in
  // AllocationBar; the draw/create gating is the conditional onDraw/onEdit + the hidden "+" below).
  // null/owner/admin/editor (incl. OFF/local) → fully editable, byte-identical to today. The server
  // 403 backstops a write regardless; this is the UX read-only surface.
  const canEdit = useCanEdit();
  const toggleGroup = useStore((s) => s.toggleGroup);
  const clearFilters = useStore((s) => s.clearFilters);
  // WCAG 4.1.3: the latest screen-reader capacity announcement, set by AllocationBar after a
  // KEYBOARD-committed move/resize. Rendered ONCE below in a polite aria-live region. It changes
  // only on a keyboard edit (not a scroll/zoom/modal/render), so subscribing here adds no hot-path
  // re-render; pointer drags never set it, so they stay silent for screen readers (sighted feedback).
  const srAnnouncement = useStore((s) => s.srAnnouncement);
  const announceStatus = useStore((s) => s.announceCapacity);
  const [modal, setModal] = useState<ModalState | null>(null);
  const previousDrawMode = useRef(ui.drawMode);
  useEffect(() => {
    if (previousDrawMode.current === ui.drawMode) return;
    previousDrawMode.current = ui.drawMode;
    announceStatus(
      ui.drawMode === "timeoff" ? m.scheduler_sr_timeoff_mode_enabled() : m.scheduler_sr_work_mode_enabled(),
    );
  }, [announceStatus, ui.drawMode]);

  const viewport = useSchedulerViewport({ ui, minimiseWeekends, snapToWeekStart, calendarWeekStartsOn });
  const { scrollRef, headerRef, stickyHeaderHeight, timelineWidth, days, dayWidth, geom, onScroll, visibleStartDate } =
    viewport;
  const { model, density, today, todayX, visibleWeeksLabel, visibleSpanCompact, overallUtil, filtersActive } =
    useSchedulerGridModel(prefs, viewport);
  const virtualization = useSchedulerGridVirtualization(model, ui, density, data, viewport);
  const { items, visibleClosures } = virtualization;

  // Stable callbacks so the memoised ResourceLane can skip re-rendering on
  // grid-level UI changes (e.g. opening a modal). setModal is referentially stable.
  const handleEdit = useCallback((allocationId: ID) => setModal({ kind: "edit", allocationId }), []);
  const handleDraw = useCallback((resourceId: ID, startDate: ISODate, endDate: ISODate) => {
    // Read the draw mode LIVE (getState) when the gesture FIRES, not via a closure over
    // ui.drawMode. That's load-bearing: closing over ui.drawMode would give handleDraw a fresh
    // reference on every toggle, which `onDraw` hands to every ResourceLane — failing their
    // React.memo and re-rendering every lane (and its bars) on a mode toggle. The mode that
    // matters is the one live at pointerup, which is exactly what getState() returns here, so
    // an EMPTY dep array keeps this callback referentially stable across a toggle. Time off is
    // meaningless for externals (no capacity), so a draw on their lane is a no-op rather than
    // opening a time-off form seeded with a resource the picker itself excludes.
    const state = useStore.getState();
    const drawMode = state.ui.drawMode;
    const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
    if (!resource) return;
    const scopedData = sharedScopedData(state.data, state.activeAccountId);
    // The SAME gate the model paints `creationBlocked` with, so a lane can never accept a draw on a
    // day it drew as unavailable. It scopes time off to the resource itself, so no pre-filter here.
    // EXCEPT in time-off draw mode: a closure must not swallow the gesture — sick
    // leave can legitimately start inside a closure, and the Add time off form accepts the
    // identical entry. Personal overlaps and non-working days still gate the draw.
    const gateTimeOff = scopedData.timeOff;
    if (
      isCreationStartBlocked(
        resource,
        startDate,
        gateTimeOff,
        accountWorkingDaysFor(state.data, state.activeAccountId),
        drawMode === "timeoff" ? [] : scopedData.closures,
      )
    ) {
      return;
    }
    if (drawMode === "timeoff") {
      if (isExternalResource(resource)) return;
    }
    setModal({
      kind: drawMode === "timeoff" ? "timeoff" : "create",
      resourceId,
      startDate,
      endDate,
    });
  }, []);

  return (
    // A SINGLE shared TooltipProvider for the whole grid: every AllocationBar's popover is a
    // provider-less TooltipRoot, so the provider machinery is paid once here instead of per bar
    // across the virtualised grid (the same hoist pattern as ui/sidebar.tsx).
    <TooltipProvider>
      {/* h-full passthrough wrapper: holds the scrolling role="grid" plus its sibling live region.
        The grid must own ONLY row/rowgroup children (WCAG aria-required-children), so the polite
        status region lives HERE, a sibling of the grid — not inside it. It's sr-only (position:
        absolute, zero layout), so this wrapper adds no visual change and the grid's h-full still
        resolves against the same definite height it did before. */}
      <div className="h-full">
        <div
          ref={scrollRef}
          /* overscroll-x-contain: hitting the timeline's left edge must NOT chain into the
           page — on macOS that overscroll is the browser's back-swipe, which nukes the app. */
          className="relative flex h-full flex-col overflow-auto overscroll-x-contain bg-scheduler-canvas"
          data-testid="scheduler-grid"
          /* Draw mode changes CSS here and inert on ResourceLane's BarsLayer. Stable lane/bar
             props keep the memoised children from re-rendering; drawModeRerender.test pins this. */
          data-draw-mode={ui.drawMode}
          role="grid"
          aria-label={m.scheduler_grid_aria()}
          // Two-column grid (WCAG 1.3.1): col 1 = the sticky left resource/utilisation column
          // (every row's rowheader / the header's columnheader), col 2 = the timeline lane
          // (the gridcell / the DateHeader columnheader). aria-colcount declares that structure so
          // the grid honestly exposes the columns it implies; every left cell carries aria-colindex=1
          // and every right cell aria-colindex=2 below. (Keyboard nav is on the bars — role="button",
          // not the cells — so these indices are pure structure, not a focus model.)
          aria-colcount={2}
          aria-rowcount={items.length + 1 + (model.length === 0 ? 1 : 0)}
          onScroll={onScroll}
          // Publish the measured sticky-header height so each AllocationBar's scroll-margin-top reserves
          // the REAL chrome on focus (WCAG 2.4.11), tracking the two-tier header's actual rendered height
          // (zoom/font-size dependent) instead of the LAYOUT.headerHeight floor. Cast: a CSS custom
          // property isn't in React's CSSProperties type.
          style={{
            ["--sched-sticky-top" as string]: `${stickyHeaderHeight}px`,
            // DateHeader aligns wide-view month labels to the VISIBLE part of their month.
            // The scroll offset is updated imperatively by useSchedulerViewport so horizontal
            // scrolling moves only a CSS variable instead of re-rendering the scheduler per pixel.
            ["--sched-visible-width" as string]: `${Math.max(0, timelineWidth - LAYOUT.leftColWidth)}px`,
          }}
        >
          <SchedulerGridHeader
            headerRef={headerRef}
            utilizationPrefs={utilizationPrefs}
            visibleWeeksLabel={visibleWeeksLabel}
            visibleSpanCompact={visibleSpanCompact}
            overallUtil={overallUtil}
            days={days}
            dayWidth={dayWidth}
            geom={geom}
            ui={ui}
            calendarWeekStartsOn={calendarWeekStartsOn}
            today={today}
          />

          {model.length === 0 && (
            // Empty body, below the still-rendered toolbar + date header, centring the shared EmptyState
            // (the same icon/heading/subtext/CTA pattern the entity lists use). The grid scrolls
            // horizontally (its header is min-w-max), so this must be sticky left-0 + bounded to the
            // measured viewport width (timelineWidth) or the centred card drifts off-screen with the
            // scroll — and it must be a DIRECT child of the overflow-auto grid for sticky to pin (nested
            // inside the wide row it did not). role=grid > row > gridcell keeps the a11y tree valid.
            <div
              role="row"
              aria-rowindex={2}
              data-testid="scheduler-empty"
              className="sticky left-0 z-[1] flex min-h-0 flex-1 items-center justify-center p-8"
              style={{ width: timelineWidth || LAYOUT.leftColWidth }}
            >
              <div role="gridcell" aria-colindex={1} aria-colspan={2} className="flex items-center justify-center">
                {filtersActive ? (
                  // Heading text is pinned EXACTLY by filters.spec.ts + US-FIL-07. The Clear-filters CTA
                  // is also the keyboard-focusable element that keeps the (scrollable) grid axe-clean when
                  // empty — without a focusable child, axe flags scrollable-region-focusable.
                  <EmptyState
                    icon={SlidersHorizontal}
                    description={m.scheduler_empty_filtered_desc()}
                    action={{
                      label: m.scheduler_empty_clear_filters(),
                      onClick: () => clearFilters(),
                    }}
                  >
                    {m.scheduler_empty_filtered_title()}
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={Users}
                    description={m.scheduler_empty_desc()}
                    action={{
                      label: m.scheduler_empty_go_resources(),
                      onClick: () => void navigate("/resources"),
                    }}
                  >
                    {m.scheduler_empty_title()}
                  </EmptyState>
                )}
              </div>
            </div>
          )}

          <SchedulerGridRows
            {...virtualization}
            ui={ui}
            density={density}
            toggleGroup={toggleGroup}
            geom={geom}
            utilizationPrefs={utilizationPrefs}
            visibleWeeksLabel={visibleWeeksLabel}
            canEdit={canEdit}
            visibleStartDate={visibleStartDate}
            setModal={setModal}
            days={days}
            todayX={todayX}
            dayWidth={dayWidth}
            calendarWeekStartsOn={calendarWeekStartsOn}
            handleEdit={handleEdit}
            handleDraw={handleDraw}
          />

          {modal && (
            <Suspense fallback={null}>
              {modal.kind === "edit" ? (
                <AllocationModal allocationId={modal.allocationId} onClose={() => setModal(null)} />
              ) : modal.kind === "timeoff" ? (
                <TimeOffForm
                  defaults={{
                    resourceId: modal.resourceId,
                    startDate: modal.startDate,
                    endDate: modal.endDate,
                  }}
                  onClose={() => setModal(null)}
                />
              ) : (
                <AllocationModal
                  create={{
                    resourceId: modal.resourceId,
                    startDate: modal.startDate,
                    endDate: modal.endDate,
                  }}
                  onClose={() => setModal(null)}
                />
              )}
            </Suspense>
          )}
        </div>

        {visibleClosures.length > 0 && (
          <div className="sr-only">
            {visibleClosures.map((closure) => (
              <span key={closure.id}>
                {m.scheduler_closure_aria({
                  name: closure.name,
                  start: closure.startDate,
                  end: closure.endDate,
                })}
              </span>
            ))}
          </div>
        )}

        {/* WCAG 4.1.3: one always-mounted polite status region, outside the grid's row-only tree.
            Keyboard edits announce capacity; pointer drags remain silent. Keying on seq lets an
            identical message announce again without moving focus from the allocation bar. */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="scheduler-live-region"
        >
          {srAnnouncement && <span key={srAnnouncement.seq}>{srAnnouncement.text}</span>}
        </div>
      </div>
    </TooltipProvider>
  );
}
