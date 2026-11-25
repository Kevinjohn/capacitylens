import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal, Users } from 'lucide-react';
import { m } from '@/i18n';
import { useStore } from '@/store/useStore';
import type { SchedulerUI } from '@/store/useStore';
import { resolveSharedScopedData } from '@/store/useScopedData';
import { listCompanyWorkingDays } from '@/store/selectors';
import { EmptyState } from '@/components/common/ui';
import { LAYOUT } from './layout';
import { SchedulerGridHeader } from './SchedulerGridHeader';
import { useSchedulerViewport } from './useSchedulerViewport';
import { isExternalResource } from '@capacitylens/shared/types/entities';
import type { ID, ISODate } from '@capacitylens/shared/types/entities';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isCreationStartBlocked } from './creationAvailability';
import { listRenderableDateRanges } from '@/lib/renderableDateRanges';
import { SchedulerGridRows } from './SchedulerGridRows';
import type { DialogState } from './schedulerGridDialog';
import { SchedulerGridActionsContext } from './schedulerGridActions';
import { useSchedulerGridPreferences, useSchedulerGridModel } from './useSchedulerGridModel';
import { useSchedulerGridVirtualization } from './useSchedulerGridVirtualization';
import { PersonScheduleSheet } from '@/components/person-schedule/PersonScheduleSheet';
import { usePersonScheduleDrawer } from '@/components/person-schedule/usePersonScheduleDrawer';

// Creation/editing forms are not needed to paint or inspect the schedule. Load them on the first
// interaction so their validation and picker dependencies do not consume the initial entry budget.
const AllocationDialog = lazy(() =>
  import('./AllocationDialog').then((module) => ({
    default: module.AllocationDialog,
  })),
);
const TimeOffForm = lazy(() =>
  import('@/components/time-off/TimeOffForm').then((module) => ({
    default: module.TimeOffForm,
  })),
);

function SchedulerDialog({ dialog, close }: { dialog: DialogState; close: () => void }) {
  if (dialog.kind === 'edit') {
    return <AllocationDialog kind="edit" allocationId={dialog.allocationId} onClose={close} />;
  }
  if (dialog.kind === 'timeOff') {
    return (
      <TimeOffForm
        defaults={{
          resourceId: dialog.resourceId,
          startDate: dialog.startDate,
          endDate: dialog.endDate,
        }}
        onClose={close}
      />
    );
  }
  return (
    <AllocationDialog
      kind="create"
      create={{
        resourceId: dialog.resourceId,
        startDate: dialog.startDate,
        endDate: dialog.endDate,
      }}
      onClose={close}
    />
  );
}

function SchedulerEmptyRow({
  filtersActive,
  timelineWidth,
  clearFilters,
  navigateToResources,
}: {
  filtersActive: boolean;
  timelineWidth: number;
  clearFilters: () => void;
  navigateToResources: () => void;
}) {
  const emptyState = filtersActive ? (
    <EmptyState
      icon={SlidersHorizontal}
      description={m.scheduler_empty_filtered_desc()}
      action={{ label: m.scheduler_empty_clear_filters(), onClick: clearFilters }}
    >
      {m.scheduler_empty_filtered_title()}
    </EmptyState>
  ) : (
    <EmptyState
      icon={Users}
      description={m.scheduler_empty_desc()}
      action={{ label: m.scheduler_empty_go_resources(), onClick: navigateToResources }}
    >
      {m.scheduler_empty_title()}
    </EmptyState>
  );
  return (
    <div
      role="row"
      aria-rowindex={2}
      data-testid="scheduler-empty"
      className="sticky left-0 z-[1] flex min-h-0 flex-1 items-center justify-center p-8"
      style={{ width: timelineWidth || LAYOUT.leftColWidth }}
    >
      <div
        role="gridcell"
        aria-colindex={1}
        aria-colspan={2}
        className="flex items-center justify-center"
      >
        {emptyState}
      </div>
    </div>
  );
}

function openDrawDialog({
  resourceId,
  startDate,
  endDate,
  setDialog,
}: {
  resourceId: ID;
  startDate: ISODate;
  endDate: ISODate;
  setDialog: (dialog: DialogState) => void;
}) {
  const state = useStore.getState();
  const drawMode = state.ui.drawMode;
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return;
  const scopedData = resolveSharedScopedData(state.data, state.activeCompanyId);
  if (
    isCreationStartBlocked({
      resource,
      date: startDate,
      timeOff: listRenderableDateRanges(scopedData.timeOff),
      companyWorkingDays: listCompanyWorkingDays(state.data, state.activeCompanyId),
      closures: drawMode === 'timeOff' ? [] : listRenderableDateRanges(scopedData.closures),
    })
  ) {
    return;
  }
  if (drawMode === 'timeOff' && isExternalResource(resource)) return;
  setDialog({
    kind: drawMode === 'timeOff' ? 'timeOff' : 'create',
    resourceId,
    startDate,
    endDate,
  });
}

function useSchedulerInteractions(ui: Pick<SchedulerUI, 'drawMode'>) {
  const screenReaderAnnouncement = useStore((state) => state.srAnnouncement);
  const announceStatus = useStore((state) => state.announceCapacity);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const previousDrawMode = useRef(ui.drawMode);
  useEffect(() => {
    if (previousDrawMode.current === ui.drawMode) return;
    previousDrawMode.current = ui.drawMode;
    announceStatus(
      ui.drawMode === 'timeOff'
        ? m.scheduler_sr_time_off_mode_enabled()
        : m.scheduler_sr_work_mode_enabled(),
    );
  }, [announceStatus, ui.drawMode]);
  const editAllocation = useCallback(
    (allocationId: ID) => setDialog({ kind: 'edit', allocationId }),
    [],
  );
  const createFromDraw = useCallback(
    (resourceId: ID, startDate: ISODate, endDate: ISODate) =>
      openDrawDialog({ resourceId, startDate, endDate, setDialog }),
    [],
  );
  return { screenReaderAnnouncement, dialog, setDialog, editAllocation, createFromDraw };
}

function SchedulerDialogHost({
  dialog,
  setDialog,
}: Pick<ReturnType<typeof useSchedulerInteractions>, 'dialog' | 'setDialog'>) {
  if (!dialog) return null;
  return (
    <Suspense fallback={null}>
      <SchedulerDialog dialog={dialog} close={() => setDialog(null)} />
    </Suspense>
  );
}

function SchedulerGridFooter({
  visibleClosures,
  screenReaderAnnouncement,
}: Pick<ReturnType<typeof useSchedulerGridVirtualization>, 'visibleClosures'> & {
  screenReaderAnnouncement: ReturnType<typeof useSchedulerInteractions>['screenReaderAnnouncement'];
}) {
  return (
    <>
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
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="scheduler-live-region"
      >
        {screenReaderAnnouncement && (
          <span key={screenReaderAnnouncement.seq}>{screenReaderAnnouncement.text}</span>
        )}
      </div>
    </>
  );
}

// Publish viewport dimensions only after measurement; an unmeasured zero would hide
// visible-span overlays instead of allowing their unclamped fallback.
function buildViewportVariables({
  stickyHeaderHeight,
  timelineWidth,
  timelineHeight,
}: Pick<
  ReturnType<typeof useSchedulerViewport>,
  'stickyHeaderHeight' | 'timelineWidth' | 'timelineHeight'
>) {
  return {
    ['--sched-sticky-top' as string]: `${stickyHeaderHeight}px`,
    ...(timelineWidth > 0
      ? {
          ['--sched-visible-width' as string]: `${Math.max(0, timelineWidth - LAYOUT.leftColWidth)}px`,
        }
      : {}),
    ...(timelineHeight > 0
      ? {
          ['--sched-visible-height' as string]: `${Math.max(0, timelineHeight - stickyHeaderHeight)}px`,
        }
      : {}),
  };
}

function SchedulerGridSurface({
  viewport,
  personScheduleDrawer,
  drawMode,
  rowCount,
  footer,
  children,
}: {
  viewport: ReturnType<typeof useSchedulerViewport>;
  personScheduleDrawer: ReturnType<typeof usePersonScheduleDrawer>;
  drawMode: SchedulerUI['drawMode'];
  rowCount: number;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { scrollRef, stickyHeaderHeight, timelineWidth, timelineHeight, onScroll } = viewport;
  return (
    <div className="h-full">
      <div
        ref={scrollRef}
        className="relative flex h-full flex-col overflow-auto overscroll-x-contain bg-scheduler-canvas"
        data-testid="scheduler-grid"
        tabIndex={-1}
        data-draw-mode={drawMode}
        role="grid"
        aria-label={m.scheduler_grid_aria()}
        aria-colcount={2}
        aria-rowcount={rowCount}
        onScroll={onScroll}
        style={buildViewportVariables({ stickyHeaderHeight, timelineWidth, timelineHeight })}
      >
        {children}
      </div>
      <PersonScheduleSheet
        open={personScheduleDrawer.open}
        schedule={personScheduleDrawer.schedule}
        onOpenChange={personScheduleDrawer.setOpen}
        onRestoreFocus={personScheduleDrawer.restoreFocus}
      />
      {footer}
    </div>
  );
}

/** Coordinates the visible week grid, resource lanes, and drawing interactions. */
export function SchedulerGrid() {
  const navigate = useNavigate();
  const preferences = useSchedulerGridPreferences();
  const toggleGroup = useStore((state) => state.toggleGroup);
  const clearFilters = useStore((state) => state.clearFilters);
  const { companyPrefs, ui, utilisationPrefs, minimiseWeekends, weekSnapEnabled } = preferences;
  const interactions = useSchedulerInteractions(ui);
  const viewport = useSchedulerViewport({
    ui,
    minimiseWeekends,
    weekSnapEnabled,
    calendarWeekStartsOn: companyPrefs.calendarWeekStartsOn,
  });
  const gridModel = useSchedulerGridModel(preferences, viewport);
  const { model, today, todayX, visibleWeeksLabel, visibleSpanCompact } = gridModel;
  const { scrollRef, headerRef, timelineWidth, days, geom, visibleStartDate } = viewport;
  const virtualization = useSchedulerGridVirtualization({
    model,
    ui,
    data: preferences.data,
    viewport,
  });
  const personScheduleDrawer = usePersonScheduleDrawer({
    data: preferences.data,
    fallbackRef: scrollRef,
  });
  const { setDialog } = interactions;
  const { viewSchedule } = personScheduleDrawer;
  const actions = useMemo(
    () => ({ setDialog, onViewSchedule: viewSchedule, visibleStartDate }),
    [setDialog, viewSchedule, visibleStartDate],
  );

  return (
    <TooltipProvider>
      <SchedulerGridActionsContext.Provider value={actions}>
        <SchedulerGridSurface
          viewport={viewport}
          personScheduleDrawer={personScheduleDrawer}
          drawMode={ui.drawMode}
          rowCount={virtualization.items.length + 1 + (model.length === 0 ? 1 : 0)}
          footer={
            <SchedulerGridFooter
              visibleClosures={virtualization.visibleClosures}
              screenReaderAnnouncement={interactions.screenReaderAnnouncement}
            />
          }
        >
          <SchedulerGridHeader
            headerRef={headerRef}
            utilisationPrefs={utilisationPrefs}
            visibleWeeksLabel={visibleWeeksLabel}
            visibleSpanCompact={visibleSpanCompact}
            overallUtil={gridModel.overallUtil}
            days={days}
            geom={geom}
            ui={ui}
            calendarWeekStartsOn={companyPrefs.calendarWeekStartsOn}
            today={today}
          />
          {model.length === 0 && (
            <SchedulerEmptyRow
              filtersActive={gridModel.filtersActive}
              timelineWidth={timelineWidth}
              clearFilters={clearFilters}
              navigateToResources={() => void navigate('/resources')}
            />
          )}
          <SchedulerGridRows
            {...virtualization}
            ui={ui}
            toggleGroup={toggleGroup}
            geom={geom}
            utilisationPrefs={utilisationPrefs}
            visibleWeeksLabel={visibleWeeksLabel}
            days={days}
            todayX={todayX}
            calendarWeekStartsOn={companyPrefs.calendarWeekStartsOn}
            onEdit={interactions.editAllocation}
            onDraw={interactions.createFromDraw}
          />
          <SchedulerDialogHost dialog={interactions.dialog} setDialog={setDialog} />
        </SchedulerGridSurface>
      </SchedulerGridActionsContext.Provider>
    </TooltipProvider>
  );
}
