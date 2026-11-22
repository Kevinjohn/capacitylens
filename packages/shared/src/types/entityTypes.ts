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

/** Every allocation status. */
export const ALLOCATION_STATUSES = ['confirmed', 'tentative', 'completed'] as const;
/** Whether an allocation is confirmed, tentative or completed. */
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];
/** How allocations are entered: by daily load against a fixed end date ('hourly',
 * the default), by volume of work spread over a span ('days'), or as a pure
 * booking block where only the span matters and load is ignored ('blocks'). */
export type SchedulingMode = (typeof SCHEDULING_MODES)[number];
/** The valid scheduling modes; the settings validator refuses anything else. */
export const SCHEDULING_MODES = ['hourly', 'days', 'blocks'] as const;
/** Who may open the Capacity Overview for a company. Null means owner/admin only. */
export type CapacityOverviewAccess = (typeof CAPACITY_OVERVIEW_ACCESS_VALUES)[number];
/** The valid access policies; the settings validator refuses anything else. */
export const CAPACITY_OVERVIEW_ACCESS_VALUES = [
  'owner_admin',
  'owner_admin_editor',
  'everyone',
] as const;
/** How human-readable dates read across a company: day/month order, and whether the day number
 * carries an ordinal suffix. Null means "day-month" ("9 Sep"). This is company data, not a device preference. A company reads one convention. */
export type DateStyle = (typeof DATE_STYLES)[number];
/** Supported date styles in Settings order; the settings validator refuses any other value. */
export const DATE_STYLES = [
  'day-month',
  'day-ordinal-month',
  'month-day',
  'month-day-ordinal',
] as const;
/** The format a null `dateStyle` reads back as. */
export const DEFAULT_DATE_STYLE: DateStyle = 'day-month';
/** Every resource kind, in the order forms and validation list them. */
export const RESOURCE_KINDS = ['person', 'placeholder', 'external'] as const;
/**
 * What a resource row represents:
 * - `person`: a real team member with capacity (the default).
 * - `placeholder`: an unfilled role/"slot", bound to one project (see `projectId`).
 * - `external`: an outsourced external-party company. Can be assigned activities, but has no
 *   hours/capacity/utilisation and is excluded from all capacity math; it renders in its own
 *   band at the bottom of the schedule. Reuses `name` (company name, required by the form) +
 *   `role` (optional descriptor); its `workingHoursPerDay`/`workingDays`/`halfDays` are unused silent
 *   defaults. See the external-resource rule in DECISIONS.md.
 */
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
/** Every employment type. */
export const EMPLOYMENT_TYPES = ['permanent', 'freelancer', 'contractor'] as const;
/** A person's contract status. */
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
/** Every resource engagement. */
export const RESOURCE_ENGAGEMENTS = ['studio', 'supplementary'] as const;
/** How the agency regards a person, independently of contract status or discipline. */
export type ResourceEngagement = (typeof RESOURCE_ENGAGEMENTS)[number];
/** Every time-off type. */
export const TIME_OFF_TYPES = ['holiday', 'sick', 'unpaid', 'other'] as const;
/** The reason for a time-off entry. */
export type TimeOffType = (typeof TIME_OFF_TYPES)[number];
/** Every activity kind, in the order validation lists them. */
export const ACTIVITY_KINDS = ['project', 'internal', 'repeatable'] as const;
/**
 * What an activity is, the axis the schedule's "activity view" filters on. Three kinds:
 * - `project`: project-specific: belongs to one project (carries `projectId`, optionally a `phaseId`).
 * - `internal`: project-less internal work (Admin, internal review/meeting).
 * - `repeatable`: all-projects: project-less activity used across many projects (Design, Workshop).
 * Coherence (enforced in assertScopedRefs and validated on import): `project` has a `projectId`;
 * `internal`/`repeatable` have neither `projectId` nor `phaseId`.
 */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Identity and revision fields shared by persisted entities. */
export interface Entity {
  id: ID;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

/** A company, the tenant. Top-level: not scoped to any other company. */
export interface Company extends Entity {
  name: string;
  color: string;
  /** How this company enters allocations. Null = 'hourly'. */
  schedulingMode: SchedulingMode | null;
  /** IANA time zone used to derive "today" for this company. Null = 'Etc/GMT'. */
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
  /** Whether this company surfaces external-party resources. Null = false (hidden out
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

/** Every domain entity belongs to exactly one company. Companies themselves don't. */
export interface ScopedEntity extends Entity {
  companyId: ID;
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
  /** Company-wide display preference for people and external resources. Null = not favourite. */
  isFavourite: boolean | null;
  /** Inclusive first date on which this person may be scheduled. Null = unbounded. */
  firstAvailableDate: ISODate | null;
  /** Inclusive last date on which this person may be scheduled. Null = unbounded. */
  lastAvailableDate: ISODate | null;
  /** ISO 8601 timestamp of when this resource was archived. Null = active.
   * Archived rows are hidden from normal scheduling views. */
  archivedAt: ISOTimestamp | null;
  /** Retained import field for previously exported deleted records. New lifecycle actions do not set it. */
  deletedAt: ISOTimestamp | null;
}

/** A client whose projects are scheduled. */
export interface Client extends ScopedEntity {
  name: string;
  color: string;
  /** When true, only company owners receive `name`; every other role receives the quoted
   * `codeName` in its place. Null = public (the default). */
  isPrivate: boolean | null;
  /** Owner-managed cover name for a private client. Stored without quotation marks; the read
   * projection adds them consistently wherever the code name is displayed. */
  codeName: string | null;
  /** Read projection only: the reader's ordering label, set by the server. Never stored, exported
   * or accepted on writes. */
  displayName?: string;
  /** True only for the built-in "Internal" pseudo-client, exactly one per company, created by
   * the seed, company setup and imports. A built-in client cannot be renamed or deleted, and a project-less
   * internal/all-projects activity buckets under it for display + filtering. Null/false = a normal,
   * user-managed client. Identified at runtime by this flag, never a hard-coded id (so it survives
   * import-remap). See shared/src/data/internalClient.ts. */
  builtin: boolean | null;
  /** ISO 8601 archive timestamp; null means active. Archived rows are hidden from scheduling. */
  archivedAt: ISOTimestamp | null;
  /** Retained import field for previously exported deleted records. New lifecycle actions do not set it. */
  deletedAt: ISOTimestamp | null;
}

/** A client project. */
export interface Project extends ScopedEntity {
  name: string;
  clientId: ID;
  color: string;
  /** When true, only company owners receive `name`; every other role receives the quoted
   * `codeName` in its place. Null = public (the default). */
  isPrivate: boolean | null;
  /** Owner-managed cover name for a private project. Stored without quotation marks; the read
   * projection adds them consistently wherever the code name is displayed. */
  codeName: string | null;
  /** Read projection only: the reader's ordering label, set by the server. Never stored, exported
   * or accepted on writes. */
  displayName?: string;
  /** ISO 8601 archive timestamp; null means active. Archived rows are hidden from scheduling. */
  archivedAt: ISOTimestamp | null;
  /** Retained import field for previously exported deleted records. New lifecycle actions do not set it. */
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
  /** ISO 8601 archive timestamp; null means active. Archived rows are hidden from scheduling. */
  archivedAt: ISOTimestamp | null;
  /** Retained import field for previously exported deleted records. New lifecycle actions do not set it. */
  deletedAt: ISOTimestamp | null;
}

/** A booking of one resource onto one activity over a date range. */
export interface Allocation extends ScopedEntity {
  resourceId: ID;
  activityId: ID;
  /** Set only for `repeatable`-activity allocations to attribute this booking to a project.
   * Null means unattributed; `project` and `internal` activities must not carry it. */
  projectId: ID | null;
  /** System-owned identity shared by allocations created in one repeat batch. Null = one-off. */
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
  ignoreWorkingDays: boolean | null;
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
  accounts: Company[];
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
