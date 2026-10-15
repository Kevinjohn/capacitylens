import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { byAccount } from "@capacitylens/shared/domain/tenancy";
import {
  emptyAppData,
  isCapacityTracked,
  isExternalResource,
  scopedTables,
  SCOPED_KEYS,
} from "@capacitylens/shared/types/entities";
import { DATE_STYLES, DEFAULT_DATE_STYLE } from "@capacitylens/shared/types/entities";
import type { DateStyle } from "@capacitylens/shared/types/entities";
import type { Account, AppData, Discipline, ID, Resource, Weekday } from "@capacitylens/shared/types/entities";
import type { SchedulerUI } from "./types";
import { DEFAULT_TIME_ZONE } from "@/lib/timezones";

const DEFAULT_CALENDAR_TIME_ZONE = DEFAULT_TIME_ZONE;
/** Monday is the default first day for calendar weeks. */
export const DEFAULT_WEEK_STARTS_ON = 1 as const;

// Missing accounts and missing setting fields must resolve to the same per-setting default.
const createAccountFieldSelector =
  <K extends keyof Account>(key: K, fallback: NonNullable<Account[K]>) =>
  (data: AppData, activeAccountId: ID | null): NonNullable<Account[K]> =>
    data.accounts.find((account) => account.id === activeAccountId)?.[key] ?? fallback;

// Mirror one company date convention into synchronous formatters. Unknown stored
// styles fall back so legacy or hand-edited rows cannot break date rendering; import
// sanitisation removes unsupported styles.
const rawDateStyle = createAccountFieldSelector("dateStyle", DEFAULT_DATE_STYLE);
/** Resolve the date display style for the active account. */
export function resolveDateStyle(data: AppData, activeAccountId: ID | null): DateStyle {
  const stored = rawDateStyle(data, activeAccountId);
  return DATE_STYLES.includes(stored) ? stored : DEFAULT_DATE_STYLE;
}

/** The active company's scheduling input mode. Absent on the account reads as 'hourly'.
 * Shared by the modal and bar. */
export const resolveSchedulingMode = createAccountFieldSelector("schedulingMode", "hourly");

/** Whether the active company uses disciplines; every discipline surface shares this value. */
export const hasDisciplinesEnabled = createAccountFieldSelector("disciplinesEnabled", true);

function isActiveSupplementary(resource: Resource): boolean {
  return resource.engagement === "supplementary" && isCapacityTracked(resource) && !resource.archivedAt;
}

/** Whether people are partitioned Studio then Supplementary in Resources, the schedule and
 * Overview. Derived, not stored: the split applies once any active, capacity-tracked resource is
 * Supplementary, so a Studio-only company reads as one list. Pass one company's resources. */
export function hasSupplementaryResources(resources: readonly Resource[]): boolean {
  return resources.some(isActiveSupplementary);
}

/** {@link hasSupplementaryResources} for the active company, read from the full store data. */
export function hasResourceEngagementGrouping(data: AppData, activeAccountId: ID | null): boolean {
  return data.resources.some((resource) => resource.accountId === activeAccountId && isActiveSupplementary(resource));
}

/** Whether the active company shows placeholders; an absent field defaults to false. */
export const hasPlaceholdersEnabled = createAccountFieldSelector("placeholdersEnabled", false);

/** Whether the active company shows external resources; an absent field defaults to false. */
export const hasExternalResourcesEnabled = createAccountFieldSelector("externalEnabled", false);

/** Whether the Allocation modal offers the inline "Add activity" input + button. Absent reads as
 * false (disabled). Single source so Settings and the modal use the same workspace value. */
export const canCreateInlineActivity = createAccountFieldSelector("inlineActivityCreateEnabled", false);

/** Whether populated allocation task text is shown in schedule details. Absent reads as false. */
export const hasVisibleTaskFieldInSchedule = createAccountFieldSelector("showTaskFieldInSchedule", false);

/** Who may open Overview. Absent reads as the restricted owner/admin default. */
export const resolveCapacityOverviewAccess = createAccountFieldSelector("capacityOverviewAccess", "owner_admin");

/** Reads the active company time zone, defaulting to DEFAULT_CALENDAR_TIME_ZONE when unavailable. */
export const resolveTimeZone = createAccountFieldSelector("timezone", DEFAULT_CALENDAR_TIME_ZONE);

/** Resolve the week start day for the active account. */
export const resolveWeekStart = createAccountFieldSelector("weekStartsOn", DEFAULT_WEEK_STARTS_ON);

/** Account-wide dates on which a schedule creation gesture may start. */
export const listAccountWorkingDays = (data: AppData, activeAccountId: ID | null): Weekday[] => {
  const account = data.accounts.find((candidate) => candidate.id === activeAccountId);
  return normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON);
};

/** Narrow the full store data to a single account: every scoped array filtered to
 * `accountId`, and `accounts` blanked (scoped views never read the tenant list).
 *
 * This is the read-side tenancy boundary, and its correctness rests on a non-local fact:
 * `SCOPED_KEYS` must be exhaustive over AppData's scoped tables. `scoped` starts as emptyAppData()
 * and only the SCOPED_KEYS are copied across, so a scoped table that AppData gains but SCOPED_KEYS
 * omits would render empty in every scoped view (the rows silently vanish). The exhaustiveness gate
 * shared/types/entities.ts keeps SCOPED_KEYS complete; never add a scoped table without it. */
export function scopeData(data: AppData, accountId: ID): AppData {
  const scoped = emptyAppData();
  const sourceTables = scopedTables(data);
  const destinationTables = scopedTables(scoped);
  for (const key of SCOPED_KEYS) {
    destinationTables[key] = sourceTables[key].filter(byAccount(accountId));
  }
  return scoped;
}

// Pure derived-state helpers. Components call these inside useMemo (keyed on the
// relevant slice) so Zustand selectors never return fresh objects directly,
// avoiding the useSyncExternalStore re-render trap.

/** List allocations assigned to one resource. */
export const listResourceAllocations = (data: AppData, resourceId: ID) =>
  data.allocations.filter((allocation) => allocation.resourceId === resourceId);

// These helpers search only the supplied account-scoped data and can miss stale IDs. Callers must
// narrow the result before dereferencing it.
/** Find an activity by its stable ID. */
export const activityById = (data: AppData, id: ID) => data.activities.find((activity) => activity.id === id);
/** Find a project by its stable ID. */
export const projectById = (data: AppData, id: ID) => data.projects.find((project) => project.id === id);
/** Find a client by its stable ID. */
export const clientById = (data: AppData, id: ID) => data.clients.find((client) => client.id === id);
/** Find a resource by its stable ID. */
export const resourceById = (data: AppData, id: ID) => data.resources.find((resource) => resource.id === id);

/** A discipline row and the resources displayed within its scheduler group. */
export interface DisciplineGroup {
  /** Null identifies the ungrouped resources bucket. */
  discipline: Discipline | null;
  resources: Resource[];
  /** True for the synthetic trailing group of external / 3rd-party resources, rendered as a
   * neutral band at the very bottom of the schedule (externals have no discipline to group by). */
  external?: boolean;
}

/** Orders scheduler disciplines by sortOrder, then display name and stable ID.
 * Management lists use alphabetical order for scanning instead.
 */
export const byDisciplineOrder = (a: Discipline, b: Discipline): number => {
  const orderDifference = a.sortOrder - b.sortOrder;
  if (orderDifference !== 0 || a.name === b.name) return orderDifference;
  return a.name < b.name ? -1 : 1;
};

/** The trailing external / 3rd-party band (neutral, always last), or null when there are none. The
 * one source for the partition so the disciplines-on (here) and disciplines-off (schedulerModel)
 * schedules can't disagree on where externals split off or how the band is shaped. */
export function buildExternalBand(resources: Resource[]): DisciplineGroup | null {
  const external = resources.filter(isExternalResource);
  return external.length ? { discipline: null, resources: external, external: true } : null;
}

/** Resources grouped by discipline (sorted), with an "ungrouped" bucket, then a trailing external
 * band last. External / 3rd-party resources are partitioned out of the discipline buckets entirely
 * so they always render as their own neutral band at the very bottom of the schedule. */
export function buildDisciplineGroups(data: AppData): DisciplineGroup[] {
  // Seed empty discipline buckets and partition resources once so large rosters are
  // not rescanned for every discipline. Unknown discipline IDs fall into the ungrouped bucket.
  const ours = data.resources.filter(isCapacityTracked);

  const resourcesByDisciplineId = new Map<ID, Resource[]>(data.disciplines.map((discipline) => [discipline.id, []]));
  const ungrouped: Resource[] = [];
  for (const resource of ours) {
    const bucket = resource.disciplineId ? resourcesByDisciplineId.get(resource.disciplineId) : undefined;
    (bucket ?? ungrouped).push(resource);
  }
  const sorted = [...data.disciplines].sort(byDisciplineOrder);
  const groups: DisciplineGroup[] = sorted.map((discipline) => ({
    discipline: discipline,
    resources: resourcesByDisciplineId.get(discipline.id) ?? [],
  }));
  if (ungrouped.length) groups.push({ discipline: null, resources: ungrouped });
  const band = buildExternalBand(data.resources);
  if (band) groups.push(band);
  return groups;
}

/** Calculate the date range currently shown by the scheduler. */
export function buildVisibleRange(schedulerUi: SchedulerUI): { start: string; end: string } {
  return { start: schedulerUi.originDate, end: addDaysISO(schedulerUi.originDate, schedulerUi.rangeDays - 1) };
}
