import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, Users } from "lucide-react";
import { m } from "@/i18n";
import { useStore } from "../../store/useStore";
import type { SchedulerUI } from "../../store/useStore";
import { useCanEdit } from "../../auth/permissionContext";
import { resolveSharedScopedData } from "../../store/useScopedData";
import { listAccountWorkingDays } from "../../store/selectors";
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
import { PersonScheduleSheet } from "../person-schedule/PersonScheduleSheet";
import { usePersonScheduleDrawer } from "../person-schedule/usePersonScheduleDrawer";

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

function SchedulerModal({ modal, close }: { modal: ModalState; close: () => void }) {
  if (modal.kind === "edit") {
    return <AllocationModal kind="edit" allocationId={modal.allocationId} onClose={close} />;
  }
  if (modal.kind === "timeoff") {
    return (
      <TimeOffForm
        defaults={{ resourceId: modal.resourceId, startDate: modal.startDate, endDate: modal.endDate }}
        onClose={close}
      />
    );
  }
  return (
    <AllocationModal
      kind="create"
      create={{ resourceId: modal.resourceId, startDate: modal.startDate, endDate: modal.endDate }}
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
      <div role="gridcell" aria-colindex={1} aria-colspan={2} className="flex items-center justify-center">
        {emptyState}
      </div>
    </div>
  );
}

function openDrawModal({
  resourceId,
  startDate,
  endDate,
  setModal,
}: {
  resourceId: ID;
  startDate: ISODate;
  endDate: ISODate;
  setModal: (modal: ModalState) => void;
}) {
  const state = useStore.getState();
  const drawMode = state.ui.drawMode;
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return;
  const scopedData = resolveSharedScopedData(state.data, state.activeAccountId);
  if (
    isCreationStartBlocked({
      resource,
      date: startDate,
      timeOff: scopedData.timeOff,
      accountWorkingDays: listAccountWorkingDays(state.data, state.activeAccountId),
      closures: drawMode === "timeoff" ? [] : scopedData.closures,
    })
  ) {
    return;
  }
  if (drawMode === "timeoff" && isExternalResource(resource)) return;
  setModal({ kind: drawMode === "timeoff" ? "timeoff" : "create", resourceId, startDate, endDate });
}

function useSchedulerInteractions(ui: Pick<SchedulerUI, "drawMode">) {
  const screenReaderAnnouncement = useStore((state) => state.srAnnouncement);
  const announceStatus = useStore((state) => state.announceCapacity);
  const [modal, setModal] = useState<ModalState | null>(null);
  const previousDrawMode = useRef(ui.drawMode);
  useEffect(() => {
    if (previousDrawMode.current === ui.drawMode) return;
    previousDrawMode.current = ui.drawMode;
    announceStatus(
      ui.drawMode === "timeoff" ? m.scheduler_sr_timeoff_mode_enabled() : m.scheduler_sr_work_mode_enabled(),
    );
  }, [announceStatus, ui.drawMode]);
  const editAllocation = useCallback((allocationId: ID) => setModal({ kind: "edit", allocationId }), []);
  const createFromDraw = useCallback(
    (resourceId: ID, startDate: ISODate, endDate: ISODate) =>
      openDrawModal({ resourceId, startDate, endDate, setModal }),
    [],
  );
  return { screenReaderAnnouncement, modal, setModal, editAllocation, createFromDraw };
}

function useGridVirtualization(
  preferences: ReturnType<typeof useSchedulerGridPreferences>,
  viewport: ReturnType<typeof useSchedulerViewport>,
  gridModel: ReturnType<typeof useSchedulerGridModel>,
) {
  return useSchedulerGridVirtualization({
    model: gridModel.model,
    ui: preferences.ui,
    density: gridModel.density,
    data: preferences.data,
    viewport,
  });
}

type GridViewProps = {
  preferences: ReturnType<typeof useSchedulerGridPreferences>;
  gridModel: ReturnType<typeof useSchedulerGridModel>;
  virtualization: ReturnType<typeof useSchedulerGridVirtualization>;
  headerRef: ReturnType<typeof useSchedulerViewport>["headerRef"];
  timelineWidth: number;
  days: ReturnType<typeof useSchedulerViewport>["days"];
  geom: ReturnType<typeof useSchedulerViewport>["geom"];
  visibleStartDate: ReturnType<typeof useSchedulerViewport>["visibleStartDate"];
  canEdit: boolean;
  toggleGroup: ReturnType<typeof useStore.getState>["toggleGroup"];
  clearFilters: ReturnType<typeof useStore.getState>["clearFilters"];
  navigateToResources: () => void;
  interactions: ReturnType<typeof useSchedulerInteractions>;
  personScheduleTitlesByResourceId: ReadonlyMap<string, string>;
  onViewSchedule: (resourceId: ID, opener: HTMLButtonElement) => void;
};

function SchedulerModalBoundary({ interactions }: Pick<GridViewProps, "interactions">) {
  if (!interactions.modal) return null;
  return (
    <Suspense fallback={null}>
      <SchedulerModal modal={interactions.modal} close={() => interactions.setModal(null)} />
    </Suspense>
  );
}

function SchedulerGridContents(props: GridViewProps) {
  const { preferences, gridModel, virtualization, interactions } = props;
  const { headerRef, timelineWidth, days, geom, visibleStartDate } = props;
  const { canEdit, toggleGroup, clearFilters, navigateToResources } = props;
  const { ui, utilizationPrefs, accountPrefs } = preferences;
  const { model, density, today, todayX, visibleWeeksLabel, visibleSpanCompact, overallUtil, filtersActive } =
    gridModel;
  return (
    <>
      <SchedulerGridHeader
        headerRef={headerRef}
        utilizationPrefs={utilizationPrefs}
        visibleWeeksLabel={visibleWeeksLabel}
        visibleSpanCompact={visibleSpanCompact}
        overallUtil={overallUtil}
        days={days}
        geom={geom}
        ui={ui}
        calendarWeekStartsOn={accountPrefs.calendarWeekStartsOn}
        today={today}
      />
      {model.length === 0 && (
        <SchedulerEmptyRow
          filtersActive={filtersActive}
          timelineWidth={timelineWidth}
          clearFilters={clearFilters}
          navigateToResources={navigateToResources}
        />
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
        setModal={interactions.setModal}
        days={days}
        todayX={todayX}
        calendarWeekStartsOn={accountPrefs.calendarWeekStartsOn}
        handleEdit={interactions.editAllocation}
        handleDraw={interactions.createFromDraw}
        personScheduleTitlesByResourceId={props.personScheduleTitlesByResourceId}
        onViewSchedule={props.onViewSchedule}
      />
      <SchedulerModalBoundary interactions={interactions} />
    </>
  );
}

function SchedulerGridFooter({
  virtualization,
  screenReaderAnnouncement,
}: Pick<GridViewProps, "virtualization"> & {
  screenReaderAnnouncement: ReturnType<typeof useSchedulerInteractions>["screenReaderAnnouncement"];
}) {
  return (
    <>
      {virtualization.visibleClosures.length > 0 && (
        <div className="sr-only">
          {virtualization.visibleClosures.map((closure) => (
            <span key={closure.id}>
              {m.scheduler_closure_aria({ name: closure.name, start: closure.startDate, end: closure.endDate })}
            </span>
          ))}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="scheduler-live-region">
        {screenReaderAnnouncement && <span key={screenReaderAnnouncement.seq}>{screenReaderAnnouncement.text}</span>}
      </div>
    </>
  );
}

function SchedulerGridSurface({
  contents,
  viewport,
  personScheduleDrawer,
}: {
  contents: GridViewProps;
  viewport: ReturnType<typeof useSchedulerViewport>;
  personScheduleDrawer: ReturnType<typeof usePersonScheduleDrawer>;
}) {
  const { gridModel, virtualization, interactions, preferences } = contents;
  const { scrollRef, stickyHeaderHeight, timelineWidth, onScroll } = viewport;
  return (
    <div className="h-full">
      <div
        ref={scrollRef}
        className="relative flex h-full flex-col overflow-auto overscroll-x-contain bg-scheduler-canvas"
        data-testid="scheduler-grid"
        tabIndex={-1}
        data-draw-mode={preferences.ui.drawMode}
        role="grid"
        aria-label={m.scheduler_grid_aria()}
        aria-colcount={2}
        aria-rowcount={virtualization.items.length + 1 + (gridModel.model.length === 0 ? 1 : 0)}
        onScroll={onScroll}
        style={{
          ["--sched-sticky-top" as string]: `${stickyHeaderHeight}px`,
          ["--sched-visible-width" as string]: `${Math.max(0, timelineWidth - LAYOUT.leftColWidth)}px`,
        }}
      >
        <SchedulerGridContents {...contents} />
      </div>
      <PersonScheduleSheet
        open={personScheduleDrawer.open}
        schedule={personScheduleDrawer.schedule}
        onOpenChange={personScheduleDrawer.setOpen}
        onRestoreFocus={personScheduleDrawer.restoreFocus}
      />
      <SchedulerGridFooter
        virtualization={virtualization}
        screenReaderAnnouncement={interactions.screenReaderAnnouncement}
      />
    </div>
  );
}

export function SchedulerGrid() {
  const navigate = useNavigate();
  const preferences = useSchedulerGridPreferences();
  const canEdit = useCanEdit();
  const toggleGroup = useStore((state) => state.toggleGroup);
  const clearFilters = useStore((state) => state.clearFilters);
  const { accountPrefs, ui, minimiseWeekends, snapToWeekStart } = preferences;
  const interactions = useSchedulerInteractions(ui);
  const viewport = useSchedulerViewport({
    ui,
    minimiseWeekends,
    snapToWeekStart,
    calendarWeekStartsOn: accountPrefs.calendarWeekStartsOn,
  });
  const gridModel = useSchedulerGridModel(preferences, viewport);
  const { scrollRef, headerRef, timelineWidth, days, geom, visibleStartDate } = viewport;
  const virtualization = useGridVirtualization(preferences, viewport, gridModel);
  const personScheduleDrawer = usePersonScheduleDrawer({ data: preferences.data, fallbackRef: scrollRef });

  const contents = {
    preferences,
    gridModel,
    virtualization,
    headerRef,
    timelineWidth,
    days,
    geom,
    visibleStartDate,
    canEdit,
    toggleGroup,
    clearFilters,
    navigateToResources: () => void navigate("/resources"),
    interactions,
    personScheduleTitlesByResourceId: personScheduleDrawer.titlesByResourceId,
    onViewSchedule: personScheduleDrawer.viewSchedule,
  };
  return (
    <TooltipProvider>
      <SchedulerGridSurface contents={contents} viewport={viewport} personScheduleDrawer={personScheduleDrawer} />
    </TooltipProvider>
  );
}
