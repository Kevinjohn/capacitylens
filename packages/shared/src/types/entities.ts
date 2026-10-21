// Core domain types for CapacityLens. Pure data shapes. No behaviour lives here.

/** A table-global row identifier; generated rows normally use UUIDs. */
export type ID = string;
/** Calendar date without a time, `YYYY-MM-DD`. */
export type ISODate = string;
/** Full UTC instant as produced by `new Date().toISOString()`. */
export type ISOTimestamp = string;

/** 0 = Sunday … 6 = Saturday (matches JS Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Fixed capacity of a resource weekday marked as a half day. */
export const HALF_DAY_HOURS = 4;

/** Whether an allocation is confirmed, tentative or completed. */
export type AllocationStatus = "confirmed" | "tentative" | "completed";
/** How allocations are entered: by daily load against a fixed end date ('hourly',
 * the default), by volume of work spread over a span ('days'), or as a pure
 * booking block where only the span matters and load is ignored ('blocks'). */
export type SchedulingMode = "hourly" | "days" | "blocks";
/** Runtime list of the valid scheduling modes, the single source the server's
 * sanitiser uses to reject a junk `schedulingMode` on a direct account write. */
export const SCHEDULING_MODES: SchedulingMode[] = ["hourly", "days", "blocks"];
/** Who may open the Capacity Overview for an account. Null means owner/admin only. */
export type CapacityOverviewAccess = "owner_admin" | "owner_admin_editor" | "everyone";
/** Runtime list used by import and server sanitisation to reject unknown access policies. */
export const CAPACITY_OVERVIEW_ACCESS_VALUES: CapacityOverviewAccess[] = [
  "owner_admin",
  "owner_admin_editor",
  "everyone",
];
/** How human-readable dates read across an account: day/month order, and whether the day number
 * carries an ordinal suffix. Null means "day-month" ("9 Sep"). This is account data, not a device preference. A company reads one convention. */
export type DateStyle = "day-month" | "day-ordinal-month" | "month-day" | "month-day-ordinal";
/** Supported date styles in Settings order; server/import sanitization rejects values absent from this list.
 * Keep this list aligned with DateStyle; the array type alone does not enforce union completeness. */
export const DATE_STYLES: DateStyle[] = ["day-month", "day-ordinal-month", "month-day", "month-day-ordinal"];
/** The format a null `dateStyle` reads back as. */
export const DEFAULT_DATE_STYLE: DateStyle = "day-month";
/**
 * What a resource row represents:
 * - `person`: a real team member with capacity (the default).
 * - `placeholder`: an unfilled role/"slot", bound to one project (see `projectId`).
 * - `external`: an outsourced 3rd-party company. Can be assigned activities, but has no
 *   hours/capacity/utilisation and is excluded from all capacity math; it renders in its own
 *   band at the bottom of the schedule. Reuses `name` (company name, required by the form) +
 *   `role` (optional descriptor); its `workingHoursPerDay`/`workingDays`/`halfDays` are unused silent
 *   defaults. See the external-resource rule in DECISIONS.md.
 */
export type ResourceKind = "person" | "placeholder" | "external";
/** A person's contract status. */
export type EmploymentType = "permanent" | "freelancer" | "contractor";
/** How the agency regards a person, independently of contract status or discipline. */
export type ResourceEngagement = "studio" | "supplementary";
/** The reason for a time-off entry. */
export type TimeOffType = "holiday" | "sick" | "unpaid" | "other";
/**
 * What an activity is, the axis the schedule's "activity view" filters on. Three kinds:
 * - `project`: project-specific: belongs to one project (carries `projectId`, optionally a `phaseId`).
 * - `internal`: project-less internal work (Admin, internal review/meeting).
 * - `repeatable`: all-projects: project-less activity used across many projects (Design, Workshop).
 * Coherence (enforced in assertScopedRefs, repaired on import): `project` has a `projectId`;
 * `internal`/`repeatable` have neither `projectId` nor `phaseId`.
 */
export type ActivityKind = "project" | "internal" | "repeatable";

/** Identity and revision fields shared by persisted entities. */
export interface Entity {
  id: ID;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

/** A tenant. Top-level: not scoped to any other account. Retired preferences keep their SQLite
 * columns (listed in server/src/schema/historicalSpecs.ts) but are no longer part of this shape. */
export interface Account extends Entity {
  name: string;
  color: string;
  /** How this company enters allocations. Null = 'hourly'. */
  schedulingMode: SchedulingMode | null;
  /** IANA time zone used to derive "today" for this account. Null = 'Etc/GMT'. */
  timezone: string | null;
  /** Which weekday starts the week: 0 = Sunday, 1 = Monday. Null = 1. */
  weekStartsOn: 0 | 1 | null;
  /** Weekdays on which schedule creation may start. Stored as a set; presentation follows weekStartsOn. */
  workingDays: Weekday[] | null;
  /** UI language for this company. Null = 'en'. English-only for now.
   * Frozen after creation. Not shown in Settings while English is the only option. */
  language: string | null;
  /** Whether this company uses disciplines. Null = true.
   * When false, disciplines are hidden across the whole UI (nav, resource form,
   * schedule grouping + filter, lists, command palette). The data is preserved. */
  disciplinesEnabled: boolean | null;
  /** Whether this company surfaces placeholder ("slot") resources. Null = false
   * (hidden out of the box, not `?? true` like disciplinesEnabled) so new companies start
   * with placeholders off. When false, placeholders are hidden across the UI; the data is
   * preserved and returns when re-enabled. */
  placeholdersEnabled: boolean | null;
  /** Whether this company surfaces external / 3rd-party resources. Null = false (hidden out
   * of the box, like placeholdersEnabled) so new companies start with external off. When false,
   * external resources are hidden across the UI; the data is preserved and returns when re-enabled. */
  externalEnabled: boolean | null;
  /** Whether the scheduler's Allocation modal offers the inline "Add activity" input + button.
   * Null = false (hidden). When false the inline creator is not rendered; the Activity picker
   * itself still works normally. */
  inlineActivityCreateEnabled: boolean | null;
  /** Whether populated allocation task text is shown in schedule details. Null = false. */
  showTaskFieldInSchedule: boolean | null;
  /** Who may open Capacity Overview. Null = owner/admin only. */
  capacityOverviewAccess: CapacityOverviewAccess | null;
  /** How human-readable dates read across this company. Null = 'day-month' ("9 Sep"). Editors
   * and up may change it, and it applies to every member: a schedule where half the rows read
   * "9 Sep" and half read "Sep 9" is the problem the setting exists to remove. */
  dateStyle: DateStyle | null;
}

/** Every domain entity belongs to exactly one account. Accounts themselves don't. */
export interface ScopedEntity extends Entity {
  accountId: ID;
}

/** A team discipline that groups people and sets their colour. */
export interface Discipline extends ScopedEntity {
  name: string;
  color: string | null;
  // The scheduler uses this value to group disciplines consistently.
  sortOrder: number;
}

/** A schedulable resource: a person, a placeholder or an external supplier. */
export interface Resource extends ScopedEntity {
  kind: ResourceKind;
  /** Optional: placeholders may be nameless (shown by `role`). For `external` this holds the
   * company name (the External form requires it). */
  name: string | null;
  /** e.g. "Senior Designer", the label used for nameless placeholders; an `external`'s
   * optional descriptor (e.g. "Print", "Overflow dev"). */
  role: string;
  /** Optional externally hosted avatar for people. Must be an absolute HTTPS URL without credentials. */
  avatarUrl: string | null;
  disciplineId: ID | null;
  employmentType: EmploymentType;
  engagement: ResourceEngagement;
  /** Capacity per working day. Unused (silent default) for `external`, externals have no capacity. */
  workingHoursPerDay: number;
  /** Working weekdays, e.g. [1,2,3,4,5] for Mon–Fri. Unused for placeholders and externals. */
  workingDays: Weekday[];
  /** Working weekdays whose capacity is the fixed four-hour half day. Always a subset of workingDays.
   * Unused for placeholders and externals. */
  halfDays: Weekday[];
  /** Placeholders only: the single project a placeholder is bound to. */
  projectId: ID | null;
  color: string;
  /** Account-wide display preference for people and external resources. Null = not favourite. */
  isFavourite: boolean | null;
  /** Inclusive first date on which this person may be scheduled. Null = unbounded. */
  firstAvailableDate: ISODate | null;
  /** Inclusive last date on which this person may be scheduled. Null = unbounded. */
  lastAvailableDate: ISODate | null;
  /** ISO 8601 timestamp of when this resource was archived (soft, reversible): hidden from
   * scheduling but fully retained. Null = active (not archived). Part of the
   * Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   * shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt: ISOTimestamp | null;
  /** ISO 8601 timestamp of the soft-delete tombstone: when this resource was soft-deleted.
   * Null = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   * soft-delete requires prior archival, and a tombstone is hard-purged only after
   * PURGE_MIN_AGE_DAYS, all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt: ISOTimestamp | null;
}

/** A client whose projects are scheduled. */
export interface Client extends ScopedEntity {
  name: string;
  color: string;
  /** When true, only account owners receive `name`; every other role receives the quoted
   * `codeName` in its place. Null = public (the default). */
  isPrivate: boolean | null;
  /** Owner-managed cover name for a private client. Stored without quotation marks; the read
   * projection adds them consistently wherever the code name is displayed. */
  codeName: string | null;
  /** True only for the built-in "Internal" pseudo-client, exactly one per account, created by
   * seed / addAccount / migrate. A built-in client cannot be renamed or deleted, and a project-less
   * internal/all-projects activity buckets under it for display + filtering. Null/false = a normal,
   * user-managed client. Identified at runtime by this flag, never a hard-coded id (so it survives
   * import-remap). See shared/src/data/internalClient.ts. */
  builtin: boolean | null;
  /** ISO 8601 timestamp of when this client was archived (soft, reversible): hidden from
   * scheduling but fully retained. Null = active (not archived). Part of the
   * Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   * shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt: ISOTimestamp | null;
  /** ISO 8601 timestamp of the soft-delete tombstone: when this client was soft-deleted.
   * Null = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   * soft-delete requires prior archival, and a tombstone is hard-purged only after
   * PURGE_MIN_AGE_DAYS, all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt: ISOTimestamp | null;
}

/** A client project. */
export interface Project extends ScopedEntity {
  name: string;
  clientId: ID;
  color: string;
  /** When true, only account owners receive `name`; every other role receives the quoted
   * `codeName` in its place. Null = public (the default). */
  isPrivate: boolean | null;
  /** Owner-managed cover name for a private project. Stored without quotation marks; the read
   * projection adds them consistently wherever the code name is displayed. */
  codeName: string | null;
  /** ISO 8601 timestamp of when this project was archived (soft, reversible): hidden from
   * scheduling but fully retained. Null = active (not archived). Part of the
   * Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   * shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt: ISOTimestamp | null;
  /** ISO 8601 timestamp of the soft-delete tombstone: when this project was soft-deleted.
   * Null = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   * soft-delete requires prior archival, and a tombstone is hard-purged only after
   * PURGE_MIN_AGE_DAYS, all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt: ISOTimestamp | null;
}

/** A named phase of a project. */
export interface Phase extends ScopedEntity {
  name: string;
  projectId: ID;
}

/** A unit of work that allocations book time against. */
export interface Activity extends ScopedEntity {
  name: string;
  /** What this activity is: project-specific work, internal work, or an all-projects activity. The
   * discriminant the schedule's activity lens filters on. See {@link ActivityKind}. */
  kind: ActivityKind;
  /** Set only for `kind: 'project'`, the project this activity belongs to. Internal and
   * all-projects (`repeatable`) activities are project-less at the activity level; repeatable
   * allocations may carry their own project attribution. */
  projectId: ID | null;
  phaseId: ID | null;
  /** ISO 8601 timestamp of when this activity was archived (soft, reversible): hidden from
   * scheduling but fully retained. Null = active (not archived). */
  archivedAt: ISOTimestamp | null;
  /** ISO 8601 timestamp of the soft-delete tombstone. Null = not deleted. */
  deletedAt: ISOTimestamp | null;
}

/** A booking of one resource onto one activity over a date range. */
export interface Allocation extends ScopedEntity {
  resourceId: ID;
  activityId: ID;
  /** Set only for `repeatable`-activity allocations to attribute this booking to a project.
   * Null means unattributed; `project` and `internal` activities must not carry it. */
  projectId: ID | null;
  /** System-owned identity shared by allocations created in one repeat batch. Null = one-off or legacy repeat. */
  seriesId: ID | null;
  // Both date bounds include the named day.
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  status: AllocationStatus;
  note: string | null;
  /** Optional short, single-line work description shown in schedule details when enabled. */
  task: string | null;
  /** When true, this allocation treats weekends / non-working days as normal
   * working days (drag/move does not auto-extend across them). Null =
   * weekend-aware (the default). */
  ignoreWeekends: boolean | null;
}

/** One person's time off over a date range; company-wide closures are {@link Closure} records. */
export interface TimeOff extends ScopedEntity {
  /** The resource taking personal time off. */
  resourceId: ID;
  // Both date bounds include the named day.
  startDate: ISODate;
  endDate: ISODate;
  type: TimeOffType;
  note: string | null;
}

/** A literal inclusive span when the company is closed to people and placeholders. */
export interface Closure extends ScopedEntity {
  name: string;
  startDate: ISODate;
  endDate: ISODate;
}

/** Every portable table, as held in memory and exported. */
export interface AppData {
  accounts: Account[];
  disciplines: Discipline[];
  resources: Resource[];
  clients: Client[];
  projects: Project[];
  phases: Phase[];
  activities: Activity[];
  allocations: Allocation[];
  timeOff: TimeOff[];
  closures: Closure[];
}

export {
  APP_DATA_KEYS,
  SCOPED_KEYS,
  APP_DATA_WRITE_ORDER,
  SCOPED_WRITE_ORDER,
  FULL_DAY_HOURS,
  MAX_HOURS_PER_DAY,
} from "./entityKeys.js";
export type { AppDataKey, ScopedEntityKey } from "./entityKeys.js";

/** Portable JSON schema version, independent of the physical SQLite schema version.
 * Increment when the portable AppData shape changes and provide the corresponding migration. */
export const EXPORT_SCHEMA_VERSION = 24;

/** The versioned export document. */
export interface PersistedState {
  schemaVersion: number;
  data: AppData;
  /** Legacy compare-and-swap revision retained for import compatibility. */
  revision: number | null;
}

export {
  carriesHourlyLoad,
  isScopedEntityKey,
  scopedTables,
  clampHoursPerDay,
  clampWorkingHoursPerDay,
  isExternalResource,
  isCapacityTracked,
  hasPersonalWorkingPattern,
  isPlaceholderResource,
  externalCapacityDefaults,
  placeholderCapacityDefaults,
  emptyAppData,
  isEmpty,
} from "./entityHelpers.js";
