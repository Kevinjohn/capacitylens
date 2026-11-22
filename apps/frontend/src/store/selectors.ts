import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays';
import { isCapacityTracked, isExternalResource } from '@capacitylens/shared/types/entities';
import { DATE_STYLES, DEFAULT_DATE_STYLE } from '@capacitylens/shared/types/entities';
import type { DateStyle } from '@capacitylens/shared/types/entities';
import type {
  Company,
  AppData,
  Discipline,
  ID,
  Resource,
  Weekday,
} from '@capacitylens/shared/types/entities';
import type { SchedulerUI } from './types';
import { DEFAULT_TIME_ZONE } from '@/lib/timezones';

const DEFAULT_CALENDAR_TIME_ZONE = DEFAULT_TIME_ZONE;
/** Monday is the default first day for calendar weeks. */
export const DEFAULT_WEEK_STARTS_ON = 1 as const;

// Missing companies and missing setting fields must resolve to the same per-setting default.
const createCompanyFieldSelector =
  <K extends keyof Company>(key: K, fallback: NonNullable<Company[K]>) =>
  (data: AppData, activeCompanyId: ID | null): NonNullable<Company[K]> =>
    data.accounts.find((company) => company.id === activeCompanyId)?.[key] ?? fallback;

// Mirror one company date convention into synchronous formatters. Unknown stored
// styles fall back so a hand-edited row cannot break date rendering.
const rawDateStyle = createCompanyFieldSelector('dateStyle', DEFAULT_DATE_STYLE);
/** Resolve the date display style for the active company. */
export function resolveDateStyle(data: AppData, activeCompanyId: ID | null): DateStyle {
  const stored = rawDateStyle(data, activeCompanyId);
  return DATE_STYLES.includes(stored) ? stored : DEFAULT_DATE_STYLE;
}

/** The active company's scheduling input mode. Absent on the company reads as 'hourly'.
 * Shared by the dialog and bar. */
export const resolveSchedulingMode = createCompanyFieldSelector('schedulingMode', 'hourly');

/** Whether the active company uses disciplines; every discipline surface shares this value. */
export const hasDisciplinesEnabled = createCompanyFieldSelector('disciplinesEnabled', true);

function isActiveSupplementary(resource: Resource): boolean {
  return (
    resource.engagement === 'supplementary' && isCapacityTracked(resource) && !resource.archivedAt
  );
}

/** Whether people are partitioned Studio then Supplementary in Resources, the schedule and
 * Overview. Derived, not stored: the split applies once any active, capacity-tracked resource is
 * Supplementary, so a Studio-only company reads as one list. Pass one company's resources. */
export function hasSupplementaryResources(resources: readonly Resource[]): boolean {
  return resources.some(isActiveSupplementary);
}

/** {@link hasSupplementaryResources} for the active company, read from the full store data. */
export function hasResourceEngagementGrouping(data: AppData, activeCompanyId: ID | null): boolean {
  return data.resources.some(
    (resource) => resource.companyId === activeCompanyId && isActiveSupplementary(resource),
  );
}

/** Whether the active company shows placeholders; an absent field defaults to false. */
export const hasPlaceholdersEnabled = createCompanyFieldSelector('placeholdersEnabled', false);

/** Whether the active company shows external resources; an absent field defaults to false. */
export const hasExternalResourcesEnabled = createCompanyFieldSelector('externalEnabled', false);

/** Whether the Allocation dialog offers the inline "Add activity" input + button. Absent reads as
 * false (disabled). Single source so Settings and the dialog use the same company value. */
export const canCreateInlineActivity = createCompanyFieldSelector(
  'inlineActivityCreateEnabled',
  false,
);

/** Whether populated allocation task text is shown in schedule details. Absent reads as false. */
export const hasVisibleTaskFieldInSchedule = createCompanyFieldSelector(
  'showTaskFieldInSchedule',
  false,
);

/** Who may open Overview. Absent reads as the restricted owner/admin default. */
export const resolveCapacityOverviewAccess = createCompanyFieldSelector(
  'capacityOverviewAccess',
  'owner_admin',
);

/** Reads the active company time zone, defaulting to DEFAULT_CALENDAR_TIME_ZONE when unavailable. */
export const resolveTimeZone = createCompanyFieldSelector('timezone', DEFAULT_CALENDAR_TIME_ZONE);

/** Resolve the week start day for the active company. */
export const resolveWeekStart = createCompanyFieldSelector('weekStartsOn', DEFAULT_WEEK_STARTS_ON);

/** Company-wide dates on which a schedule creation gesture may start. */
export const listCompanyWorkingDays = (data: AppData, activeCompanyId: ID | null): Weekday[] => {
  const company = data.accounts.find((candidate) => candidate.id === activeCompanyId);
  return normalizeCompanyWorkingDays(
    company?.workingDays,
    company?.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON,
  );
};

// Pure derived-state helpers. Components call these inside useMemo (keyed on the
// relevant slice) so Zustand selectors never return fresh objects directly,
// avoiding the useSyncExternalStore re-render trap.

// These helpers search only the supplied company-scoped data and can miss stale IDs. Callers must
// narrow the result before dereferencing it.
/** Find an activity by its stable ID. */
export const getActivityById = (data: AppData, id: ID) =>
  data.activities.find((activity) => activity.id === id);
/** Find a resource by its stable ID. */
export const getResourceById = (data: AppData, id: ID) =>
  data.resources.find((resource) => resource.id === id);

/** A discipline row and the resources displayed within its scheduler group. */
export interface DisciplineGroup {
  /** Null identifies the ungrouped resources bucket. */
  discipline: Discipline | null;
  resources: Resource[];
  /** True for the synthetic trailing group of external-party resources, rendered as a
   * neutral band at the very bottom of the schedule (externals have no discipline to group by). */
  external?: boolean;
}

/** Orders scheduler disciplines by sortOrder, then display name and stable ID.
 * Management lists use alphabetical order for scanning instead.
 */
export const compareByDisciplineOrder = (a: Discipline, b: Discipline): number => {
  const orderDifference = a.sortOrder - b.sortOrder;
  if (orderDifference !== 0) return orderDifference;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** The trailing external-party band (neutral, always last), or null when there are none. The
 * one source for the partition so the disciplines-on (here) and disciplines-off (schedulerModel)
 * schedules can't disagree on where externals split off or how the band is shaped. */
export function buildExternalBand(resources: Resource[]): DisciplineGroup | null {
  const external = resources.filter(isExternalResource);
  return external.length ? { discipline: null, resources: external, external: true } : null;
}

/** Resources grouped by discipline (sorted), with an "ungrouped" bucket, then a trailing external
 * band last. External-party resources are partitioned out of the discipline buckets entirely
 * so they always render as their own neutral band at the very bottom of the schedule. */
export function buildDisciplineGroups(data: AppData): DisciplineGroup[] {
  // Seed empty discipline buckets and partition resources once so large rosters are
  // not rescanned for every discipline. Unknown discipline IDs fall into the ungrouped bucket.
  const ours = data.resources.filter(isCapacityTracked);

  const resourcesByDisciplineId = new Map<ID, Resource[]>(
    data.disciplines.map((discipline) => [discipline.id, []]),
  );
  const ungrouped: Resource[] = [];
  for (const resource of ours) {
    const bucket = resource.disciplineId
      ? resourcesByDisciplineId.get(resource.disciplineId)
      : undefined;
    (bucket ?? ungrouped).push(resource);
  }
  const sorted = [...data.disciplines].sort(compareByDisciplineOrder);
  const groups: DisciplineGroup[] = sorted.map((discipline) => ({
    discipline,
    resources: resourcesByDisciplineId.get(discipline.id) ?? [],
  }));
  if (ungrouped.length) groups.push({ discipline: null, resources: ungrouped });
  const band = buildExternalBand(data.resources);
  if (band) groups.push(band);
  return groups;
}

/** Calculate the date range currently shown by the scheduler. */
export function buildVisibleRange(schedulerUi: SchedulerUI): { start: string; end: string } {
  return {
    start: schedulerUi.originDate,
    end: addDaysISO(schedulerUi.originDate, schedulerUi.rangeDays - 1),
  };
}
