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
import type { Account, AppData, Discipline, ID, Resource, Weekday } from "@capacitylens/shared/types/entities";
import type { SchedulerUI } from "./useStore";
import { DEFAULT_TIME_ZONE } from "../lib/timezones";

/** The calendar-facing name for the app default, single-sourced in lib/timezones.ts alongside the
 *  option-label rule that renders it as "GMT". */
const DEFAULT_CALENDAR_TIME_ZONE = DEFAULT_TIME_ZONE;
export const DEFAULT_WEEK_STARTS_ON = 1 as const;

/** One per-account setting read: the ACTIVE account's field, or `fallback` when the account is
 *  missing (no selection, a stale id, or a slice that hasn't loaded) or the field is absent.
 *  Absent-field defaults differ per setting and are load-bearing — each binding below documents
 *  its own, and a lookup miss must read the SAME default as an absent field. */
const accountField =
  <K extends keyof Account>(key: K, fallback: NonNullable<Account[K]>) =>
  (data: AppData, activeAccountId: ID | null): NonNullable<Account[K]> =>
    (data.accounts.find((a) => a.id === activeAccountId)?.[key] ?? fallback) as NonNullable<Account[K]>;

/** The active company's scheduling input mode. Absent on the account reads as the
 *  original 'hourly' behaviour. Single source so the modal and the bar can't drift. */
export const schedulingModeFor = accountField("schedulingMode", "hourly");

/** Whether the active company uses disciplines. Absent on the account reads as true
 *  (the original behaviour). Single source so every discipline surface (nav, resource
 *  form, schedule grouping + filter, lists, command palette) gates on the same value. */
export const disciplinesEnabledFor = accountField("disciplinesEnabled", true);

/** Whether the active company partitions people by engagement in Resources and within schedule
 * groups. Absent reads as TRUE so existing and new accounts receive the default-on behaviour. */
export const groupResourcesByEngagementFor = accountField("groupResourcesByEngagement", true);

/** Whether the active company shows placeholder ("slot") rows. Absent on the account reads as
 *  FALSE (hidden) — the documented default-off behaviour. NOTE the `?? false` (contrast
 *  disciplinesEnabledFor's `?? true`): a new/seed/imported account with no field stays hidden.
 *  Single source so every placeholder surface (schedule, assignee picker, Resources + Time off
 *  lists, command palette) gates on the same per-account value. */
export const placeholdersEnabledFor = accountField("placeholdersEnabled", false);

/** Whether the active company shows external / 3rd-party rows. Absent on the account reads as
 *  FALSE (hidden) — the documented default-off behaviour (`?? false`, like placeholdersEnabledFor,
 *  NOT disciplinesEnabledFor's `?? true`). Single source so every external surface gates on the
 *  same per-account value. */
export const externalEnabledFor = accountField("externalEnabled", false);

/** How the active company displays Internal work. Absent reads as neutral grey, so legacy and new
 * accounts receive the requested default without rewriting their saved project colours. */
export const internalColourModeFor = accountField("internalColourMode", "grey");

/** Whether the schedule shows INTERNAL-PROJECT allocation bars (activities under the built-in Internal
 *  client). Absent reads as TRUE (shown) — note the `?? true` (like disciplinesEnabledFor, NOT the
 *  placeholders/external `?? false`). A pure VIEW pref: it hides only bars, never capacity/utilisation. */
export const showInternalProjectsFor = accountField("showInternalProjects", true);

/** Whether the schedule shows INTERNAL-ACTIVITY allocation bars (kind 'internal'). Absent reads as
 *  TRUE (shown), the exact analog of showInternalProjectsFor. Hides bars only, never capacity. */
export const showInternalActivitiesFor = accountField("showInternalActivities", true);

/** Whether the Allocation modal offers the inline "Add activity" input + button. Absent reads as
 *  TRUE (enabled). Single source so the modal gates on the same per-account value. */
export const inlineActivityCreateEnabledFor = accountField("inlineActivityCreateEnabled", true);

/** Primitive calendar selectors avoid fresh-object Zustand snapshots while keeping defaults single-sourced. */
export const timeZoneFor = accountField("timezone", DEFAULT_CALENDAR_TIME_ZONE);

export const weekStartsOnFor = accountField("weekStartsOn", DEFAULT_WEEK_STARTS_ON);

/** Account-wide dates on which a schedule creation gesture may start. */
export const accountWorkingDaysFor = (data: AppData, activeAccountId: ID | null): Weekday[] => {
  const account = data.accounts.find((candidate) => candidate.id === activeAccountId);
  return normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON);
};

/** Narrow the full store data to a single account: every scoped array filtered to
 *  `accountId`, and `accounts` blanked (scoped views never read the tenant list).
 *
 *  This is THE read-side tenancy boundary, and its correctness rests on a NON-LOCAL fact:
 *  `SCOPED_KEYS` must be EXHAUSTIVE over AppData's scoped tables. `scoped` starts as emptyAppData()
 *  and only the SCOPED_KEYS are copied across — so a scoped table that AppData gains but SCOPED_KEYS
 *  omits would render EMPTY in every scoped view (the rows silently vanish). The exhaustiveness gate
 *  shared/types/entities.ts keeps SCOPED_KEYS complete; never add a scoped table without it. */
export function scopeData(data: AppData, accountId: ID): AppData {
  const scoped = emptyAppData();
  const src = scopedTables(data);
  const dst = scopedTables(scoped);
  for (const key of SCOPED_KEYS) {
    dst[key] = src[key].filter(byAccount(accountId));
  }
  return scoped;
}

// Pure derived-state helpers. Components call these inside useMemo (keyed on the
// relevant slice) so Zustand selectors never return fresh objects directly —
// avoiding the useSyncExternalStore re-render trap.

export const allocationsForResource = (data: AppData, resourceId: ID) =>
  data.allocations.filter((a) => a.resourceId === resourceId);

// Find-by-id helpers. Each returns `T | undefined` — `find` MISSES for a stale or cross-account
// id, so callers must narrow (optional-chain / guard) before dereferencing, never assume the id
// resolves. (The fix for a possibly-undefined result belongs at the CONSUMER, not as a throw here.)
export const activityById = (data: AppData, id: ID) => data.activities.find((t) => t.id === id);
export const projectById = (data: AppData, id: ID) => data.projects.find((p) => p.id === id);
export const clientById = (data: AppData, id: ID) => data.clients.find((c) => c.id === id);
export const resourceById = (data: AppData, id: ID) => data.resources.find((r) => r.id === id);

export interface DisciplineGroup {
  discipline: Discipline | null; // null = the "no discipline" bucket
  resources: Resource[];
  /** True for the synthetic trailing group of external / 3rd-party resources — rendered as a
   *  neutral band at the very bottom of the schedule (externals have no discipline to group by). */
  external?: boolean;
}

/** Canonical scheduler discipline ordering: by sortOrder, then name as a stable tiebreak.
 *  The management list is independently alphabetical because scanning and planning are different
 *  surfaces; keep this ordering on the scheduler path. */
export const byDisciplineOrder = (a: Discipline, b: Discipline): number =>
  a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The trailing external / 3rd-party band (neutral, always last), or null when there are none. The
 *  ONE source for the partition so the disciplines-on (here) and disciplines-off (schedulerModel)
 *  schedules can't disagree on where externals split off or how the band is shaped. */
export function externalBand(resources: Resource[]): DisciplineGroup | null {
  const external = resources.filter(isExternalResource);
  return external.length ? { discipline: null, resources: external, external: true } : null;
}

/** Resources grouped by discipline (sorted), with an "ungrouped" bucket, then a trailing EXTERNAL
 *  band last. External / 3rd-party resources are partitioned out of the discipline buckets entirely
 *  so they always render as their own neutral band at the very bottom of the schedule. */
export function resourcesByDiscipline(data: AppData): DisciplineGroup[] {
  const ours = data.resources.filter(isCapacityTracked); // externals get their own trailing band
  // One pass over the resources fills every bucket, so a large roster isn't re-scanned per
  // discipline. Every known discipline is seeded (an empty discipline still renders its group), and
  // a resource with no discipline — or one naming a discipline this slice doesn't hold — falls to
  // the ungrouped bucket.
  const byDiscipline = new Map<ID, Resource[]>(data.disciplines.map((d) => [d.id, []]));
  const ungrouped: Resource[] = [];
  for (const resource of ours) {
    const bucket = resource.disciplineId ? byDiscipline.get(resource.disciplineId) : undefined;
    (bucket ?? ungrouped).push(resource);
  }
  const sorted = [...data.disciplines].sort(byDisciplineOrder);
  const groups: DisciplineGroup[] = sorted.map((d) => ({
    discipline: d,
    resources: byDiscipline.get(d.id) ?? [],
  }));
  if (ungrouped.length) groups.push({ discipline: null, resources: ungrouped });
  const band = externalBand(data.resources);
  if (band) groups.push(band);
  return groups;
}

export function visibleRange(ui: SchedulerUI): { start: string; end: string } {
  return { start: ui.originDate, end: addDaysISO(ui.originDate, ui.rangeDays - 1) };
}
