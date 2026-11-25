import type { ComponentProps } from 'react';
import { Plus } from 'lucide-react';
import { m } from '@/i18n';
import { formatUtilisationPercent } from '@/lib/formatUtilisationPercent';
import { UTILISATION_WINDOW_DAYS } from '@/lib/schedulerConfig';
import { resolveResourceDisplayName } from '@/lib/metadata';
import type { buildSchedulerDensity } from './layout';
import { LAYOUT } from './layout';
import { ResourceLane } from './ResourceLane';
import { buildRowScreenReaderSummary } from './buildRowScreenReaderSummary';
import type { GroupModel, RowModel } from './schedulerModel';
import { isCapacityTracked, isExternalResource } from '@capacitylens/shared/types/entities';
import { Button } from '@/components/ui/button';
import { PersonScheduleTrigger } from '@/components/person-schedule/PersonScheduleTrigger';
import { resolveResourceAvatarUrl } from '@/account/resolveResourceAvatarUrl';
import { useStore } from '@/store/useStore';
import { useCanEdit } from '@/auth/permissionContext';
import { useActiveScopedData } from '@/store/useScopedData';
import { resolvePersonScheduleIdentity } from '@/components/person-schedule/usePersonSchedule';
import { useSchedulerGridActions } from './schedulerGridActions';

type LaneProps = ComponentProps<typeof ResourceLane>;
/** Props passed to the scheduler grid row component. */
export interface SchedulerGridRowProps {
  group: GroupModel;
  row: RowModel;
  rowIndex: number;
  density: ReturnType<typeof buildSchedulerDensity>;
  visibleWeeksLabel: string;
  days: LaneProps['days'];
  todayX: LaneProps['todayX'];
  geom: LaneProps['geom'];
  calendarWeekStartsOn: LaneProps['weekStartsOn'];
  onEdit: LaneProps['onEdit'];
  onDraw: LaneProps['onDraw'];
}

function ResourceIdentity({
  group,
  row,
  density,
}: Pick<SchedulerGridRowProps, 'group' | 'row' | 'density'>) {
  const { resource } = row;
  const data = useActiveScopedData();
  const { onViewSchedule } = useSchedulerGridActions();
  const scheduleTitle = resolvePersonScheduleIdentity(resource, data);
  const imageUrl = resolveResourceAvatarUrl(resource);
  // A placeholder in a discipline band takes the discipline colour; one without a discipline keeps
  // its own colour instead of the neutral Unassigned band colour. The capacity overview differs on
  // purpose: it gathers every placeholder into the uncoloured Unassigned demand band, so there a
  // placeholder always shows its own colour.
  const avatarColor =
    resource.kind === 'placeholder' && !resource.disciplineId
      ? resource.color
      : (group.color ?? resource.color);
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      style={{ height: density.identityBandHeight }}
    >
      <PersonScheduleTrigger
        resourceId={resource.id}
        scheduleTitle={scheduleTitle}
        avatarName={resource.name ?? resource.jobTitle}
        color={avatarColor}
        placeholder={resource.kind === 'placeholder'}
        {...(imageUrl ? { imageUrl } : {})}
        onViewSchedule={onViewSchedule}
      />
      <div className="ms-1.5 min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-sm font-medium">
            {resolveResourceDisplayName(resource)}
          </span>
        </div>
        <span className="block truncate text-xs text-muted-foreground">{resource.jobTitle}</span>
      </div>
    </div>
  );
}

function UtilisationCell({
  utilisation,
  overSoon,
  visibleWeeksLabel,
}: Pick<RowModel, 'utilisation' | 'overSoon'> & { visibleWeeksLabel: string }) {
  const title = overSoon
    ? m.scheduler_util_title_oversoon({ days: UTILISATION_WINDOW_DAYS, span: visibleWeeksLabel })
    : m.scheduler_util_title({ span: visibleWeeksLabel });
  return (
    <span
      data-testid="utilisation"
      title={title}
      className={`flex w-11 flex-1 items-center justify-center border-t border-line text-2xs ${
        overSoon ? 'font-semibold text-danger' : 'text-faint'
      }`}
    >
      {formatUtilisationPercent(utilisation)}%
    </span>
  );
}

function ResourceActions({
  row,
  visibleWeeksLabel,
}: Pick<SchedulerGridRowProps, 'row' | 'visibleWeeksLabel'>) {
  const drawMode = useStore((state) => state.ui.drawMode);
  const utilisationPrefs = useStore((state) => state.utilisationPrefs);
  const canEdit = useCanEdit();
  const { visibleStartDate, setDialog } = useSchedulerGridActions();
  const { resource, utilisation, overSoon } = row;
  const canCreate = canEdit && (drawMode !== 'timeOff' || !isExternalResource(resource));
  const showUtilisation = utilisationPrefs.showPersonal && isCapacityTracked(resource);
  return (
    <div className="flex shrink-0 flex-col self-stretch overflow-hidden border-s border-line text-center leading-none">
      {canCreate && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            const day = visibleStartDate();
            setDialog({
              kind: drawMode === 'timeOff' ? 'timeOff' : 'create',
              resourceId: resource.id,
              startDate: day,
              endDate: day,
            });
          }}
          aria-label={
            drawMode === 'timeOff'
              ? m.scheduler_add_time_off_for({ name: resolveResourceDisplayName(resource) })
              : m.scheduler_add_allocation_for({ name: resolveResourceDisplayName(resource) })
          }
          title={drawMode === 'timeOff' ? m.scheduler_add_time_off() : m.scheduler_add_allocation()}
          className="h-auto w-11 flex-1 rounded-none text-muted-foreground"
        >
          <Plus />
        </Button>
      )}
      {showUtilisation && (
        <UtilisationCell
          utilisation={utilisation}
          overSoon={overSoon}
          visibleWeeksLabel={visibleWeeksLabel}
        />
      )}
    </div>
  );
}

function SchedulerGridRowHeader({
  row,
  group,
  density,
  visibleWeeksLabel,
}: Pick<SchedulerGridRowProps, 'group' | 'row' | 'density' | 'visibleWeeksLabel'>) {
  const drawMode = useStore((state) => state.ui.drawMode);
  const showPersonalUtilisation = useStore((state) => state.utilisationPrefs.showPersonal);
  const { resource } = row;
  return (
    <div
      role="rowheader"
      aria-colindex={1}
      className={`sticky left-0 z-10 flex shrink-0 items-start gap-2 border-r border-line bg-scheduler-canvas ps-3 ${
        resource.kind === 'placeholder' ? 'hatch-lines' : ''
      }`}
      style={{ width: LAYOUT.leftColWidth }}
    >
      <span className="sr-only">
        {buildRowScreenReaderSummary(row, {
          showPersonalUtilisation,
          visibleSpanLabel: visibleWeeksLabel,
          drawMode,
        })}
      </span>
      <ResourceIdentity group={group} row={row} density={density} />
      <ResourceActions row={row} visibleWeeksLabel={visibleWeeksLabel} />
    </div>
  );
}

/** Renders one resource row in the scheduler grid. */
export function SchedulerGridRow(props: SchedulerGridRowProps) {
  const { row, rowIndex, density, days, todayX, geom, calendarWeekStartsOn, onEdit, onDraw } =
    props;
  const canEdit = useCanEdit();
  const { resource, rowHeight, bars, dayStates, timeOff, dimmed } = row;
  return (
    /* One scheduler-row surface on the whole row (not just the sticky header) keeps the divider
         on one background, without it the border crosses the frozen left column
         and the darker timeline, reading as a two-tone line. */
    <div
      role="row"
      aria-rowindex={rowIndex}
      data-testid="scheduler-row"
      data-dimmed={dimmed || undefined}
      title={dimmed ? m.scheduler_row_dimmed_title() : undefined}
      className={`flex border-b border-line-soft bg-scheduler-canvas ${dimmed ? 'opacity-45' : ''}`}
      style={{ height: rowHeight }}
    >
      <SchedulerGridRowHeader
        group={props.group}
        row={row}
        density={density}
        visibleWeeksLabel={props.visibleWeeksLabel}
      />

      <ResourceLane
        resourceId={resource.id}
        days={days}
        dayStates={dayStates}
        timeOff={timeOff}
        todayX={todayX}
        geom={geom}
        rowHeight={rowHeight}
        barTop={density.rowPadding}
        bars={bars}
        placeholder={resource.kind === 'placeholder'}
        weekStartsOn={calendarWeekStartsOn}
        // Withhold edit callbacks from Viewers so the lane cannot start a gesture or show the hover add hint.
        {...(canEdit && onEdit ? { onEdit } : {})}
        {...(canEdit && onDraw ? { onDraw } : {})}
      />
    </div>
  );
}
