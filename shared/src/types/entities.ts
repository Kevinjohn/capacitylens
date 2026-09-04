// Core domain types for CapacityLens. Pure data shapes — no behaviour lives here.

export type ID = string; // crypto.randomUUID()
export type ISODate = string; // date-only, "YYYY-MM-DD"
export type ISOTimestamp = string; // full ISO datetime, e.g. new Date().toISOString()

/** 0 = Sunday … 6 = Saturday (matches JS Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Fixed capacity of a resource weekday marked as a full day. */
export const FULL_DAY_HOURS = 8;
/** Fixed capacity of a resource weekday marked as a half day. */
export const HALF_DAY_HOURS = 4;

export type AllocationStatus = "confirmed" | "tentative" | "completed";
/** How allocations are entered: by daily load against a fixed end date ('hourly',
 *  the default), by volume of work spread over a span ('days'), or as a pure
 *  booking block where only the span matters and load is ignored ('blocks'). */
export type SchedulingMode = "hourly" | "days" | "blocks";
/** Runtime list of the valid scheduling modes — the single source the server's
 *  sanitiser uses to reject a junk `schedulingMode` on a direct account write. */
export const SCHEDULING_MODES: SchedulingMode[] = ["hourly", "days", "blocks"];
/** How work filed under the built-in Internal client is coloured. */
export type InternalColourMode = "grey" | "palette";
/** Runtime list used by the server/import sanitiser to reject an unknown Internal colour mode. */
export const INTERNAL_COLOUR_MODES: InternalColourMode[] = ["grey", "palette"];
/**
 * What a resource row represents:
 * - `person`      — a real team member with capacity (the default).
 * - `placeholder` — an unfilled role/"slot", bound to one project (see `projectId`).
 * - `external`    — an outsourced 3rd-party company. Can be assigned activities, but has NO
 *   hours/capacity/utilisation and is EXCLUDED from all capacity math; it renders in its own
 *   band at the bottom of the schedule. Reuses `name` (company name, required by the form) +
 *   `role` (optional descriptor); its `workingHoursPerDay`/`workingDays`/`halfDays` are unused silent
 *   defaults. See the external-resource rule in DECISIONS.md.
 */
export type ResourceKind = "person" | "placeholder" | "external";
export type EmploymentType = "permanent" | "freelancer" | "contractor";
/** How the agency regards a person, independently of contract status or discipline. */
export type ResourceEngagement = "studio" | "supplementary";
export type TimeOffType = "holiday" | "sick" | "unpaid" | "other";
/**
 * What an activity IS — the axis the schedule's "activity view" filters on. Three kinds:
 * - `project`    — project-specific: belongs to one project (carries `projectId`, optionally a `phaseId`).
 * - `internal`   — project-less internal work (Admin, internal review/meeting).
 * - `repeatable` — all-projects: project-less activity used across many projects (Design, Workshop).
 * Coherence (enforced in assertScopedRefs, repaired on import): `project` HAS a `projectId`;
 * `internal`/`repeatable` have NEITHER `projectId` nor `phaseId`.
 */
export type ActivityKind = "project" | "internal" | "repeatable";

/** Fields every persisted entity carries — cheap now, impossible to backfill later. */
export interface Entity {
  id: ID;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

/** A tenant. Top-level: not scoped to any other account. */
export interface Account extends Entity {
  name: string;
  color: string;
  /** How this company enters allocations. Absent = 'hourly' (the original behaviour). */
  schedulingMode?: SchedulingMode;
  /** IANA time zone used to derive "today" for this account. Absent = 'Etc/GMT'. */
  timezone?: string;
  /** Which weekday starts the week: 0 = Sunday, 1 = Monday. Absent = 1. */
  weekStartsOn?: 0 | 1;
  /** Weekdays on which schedule creation may start. Stored as a set; presentation follows weekStartsOn. */
  workingDays?: Weekday[];
  /** UI language for this company. Absent = 'en'. English-only until P1.5.1 (Paraglide).
   *  Frozen after creation — see P1.14. */
  language?: string;
  /** Whether this company uses disciplines. Absent = true (the original behaviour).
   *  When false, disciplines are hidden across the whole UI (nav, resource form,
   *  schedule grouping + filter, lists, command palette) — the data is preserved. */
  disciplinesEnabled?: boolean;
  /** Whether people are partitioned as Studio then Supplementary in Resources and the schedule.
   *  Absent = true, preserving the default-on company view without rewriting legacy accounts. */
  groupResourcesByEngagement?: boolean;
  /** Whether this company surfaces placeholder ("slot") resources. Absent = false
   *  (hidden out of the box — NOT `?? true` like disciplinesEnabled) so new companies start
   *  with placeholders OFF. When false, placeholders are hidden across the UI; the data is
   *  preserved and returns when re-enabled. */
  placeholdersEnabled?: boolean;
  /** Whether this company surfaces external / 3rd-party resources. Absent = false (hidden out
   *  of the box, like placeholdersEnabled) so new companies start with external OFF. When false,
   *  external resources are hidden across the UI; the data is preserved and returns when re-enabled. */
  externalEnabled?: boolean;
  /** Whether Internal activities/projects use neutral grey or their normal palette-derived colour.
   *  Absent = 'grey', the out-of-the-box behaviour. Saved project colours are preserved in grey mode. */
  internalColourMode?: InternalColourMode;
  /** Whether the schedule shows allocation bars for INTERNAL PROJECTS — activities whose project
   *  belongs to the built-in Internal client (`Client.builtin === true`). Absent = true (shown),
   *  contrast placeholdersEnabled's `?? false`. A pure VIEW pref: when false only the BARS are
   *  hidden — the work stays in the data and in capacity/utilisation, and reappears when re-enabled. */
  showInternalProjects?: boolean;
  /** Whether the schedule shows allocation bars for INTERNAL ACTIVITIES — activities of `kind:
   *  'internal'`. Absent = true (shown). A pure VIEW pref exactly like showInternalProjects: hiding
   *  removes only the bars, never the underlying load from capacity/utilisation. */
  showInternalActivities?: boolean;
  /** Whether the scheduler's Allocation modal offers the inline "Add activity" input + button.
   *  Absent = true (shown). When false the inline creator is not rendered; the Activity picker
   *  itself still works normally. */
  inlineActivityCreateEnabled?: boolean;
}

/** Every domain entity belongs to exactly one account. Accounts themselves don't. */
export interface ScopedEntity extends Entity {
  accountId: ID;
}

export interface Discipline extends ScopedEntity {
  name: string;
  color?: string;
  sortOrder: number; // controls grouping order in the scheduler
}

export interface Resource extends ScopedEntity {
  kind: ResourceKind;
  /** Optional: placeholders may be nameless (shown by `role`). For `external` this holds the
   *  COMPANY name (the External form requires it). */
  name?: string;
  /** e.g. "Senior Designer" — the label used for nameless placeholders; an `external`'s
   *  optional descriptor (e.g. "Print", "Overflow dev"). */
  role: string;
  disciplineId?: ID;
  employmentType: EmploymentType;
  engagement: ResourceEngagement;
  /** Capacity per working day. Unused (silent default) for `external` — externals have no capacity. */
  workingHoursPerDay: number;
  /** Working weekdays, e.g. [1,2,3,4,5] for Mon–Fri. Unused for placeholders and externals. */
  workingDays: Weekday[];
  /** Working weekdays whose capacity is the fixed four-hour half day. Always a subset of workingDays.
   *  Unused for placeholders and externals. */
  halfDays: Weekday[];
  /** PLACEHOLDERS ONLY: the single project a placeholder is bound to. */
  projectId?: ID;
  color: string;
  /** Account-wide display preference for people and external resources. Absent = not favourite. */
  isFavourite?: boolean;
  /** ISO 8601 timestamp of when this resource was archived (soft, reversible): hidden from
   *  scheduling but fully retained. Absent = active (not archived). Part of the
   *  Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   *  shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt?: ISOTimestamp;
  /** ISO 8601 timestamp of the soft-delete tombstone: when this resource was soft-deleted.
   *  Absent = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   *  soft-delete requires prior archival, and a tombstone is hard-purged only after
   *  PURGE_MIN_AGE_DAYS — all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt?: ISOTimestamp;
}

export interface Client extends ScopedEntity {
  name: string;
  color: string;
  /** When true, only account owners receive `name`; every other role receives the quoted
   *  `codeName` in its place. Absent = public (the default). */
  isPrivate?: boolean;
  /** Owner-managed cover name for a private client. Stored without quotation marks; the read
   *  projection adds them consistently wherever the code name is displayed. */
  codeName?: string;
  /** True ONLY for the built-in "Internal" pseudo-client — exactly one per account, created by
   *  seed / addAccount / migrate. A built-in client cannot be renamed or deleted, and a project-less
   *  internal/all-projects activity buckets under it for display + filtering. Absent/false = a normal,
   *  user-managed client. Identified at runtime by THIS flag, never a hard-coded id (so it survives
   *  import-remap). See shared/src/data/internalClient.ts. */
  builtin?: boolean;
  /** ISO 8601 timestamp of when this client was archived (soft, reversible): hidden from
   *  scheduling but fully retained. Absent = active (not archived). Part of the
   *  Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   *  shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt?: ISOTimestamp;
  /** ISO 8601 timestamp of the soft-delete tombstone: when this client was soft-deleted.
   *  Absent = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   *  soft-delete requires prior archival, and a tombstone is hard-purged only after
   *  PURGE_MIN_AGE_DAYS — all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt?: ISOTimestamp;
}

export interface Project extends ScopedEntity {
  name: string;
  clientId: ID; // REQUIRED — a project must belong to a client
  color: string;
  /** When true, only account owners receive `name`; every other role receives the quoted
   *  `codeName` in its place. Absent = public (the default). */
  isPrivate?: boolean;
  /** Owner-managed cover name for a private project. Stored without quotation marks; the read
   *  projection adds them consistently wherever the code name is displayed. */
  codeName?: string;
  /** ISO 8601 timestamp of when this project was archived (soft, reversible): hidden from
   *  scheduling but fully retained. Absent = active (not archived). Part of the
   *  Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   *  shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt?: ISOTimestamp;
  /** ISO 8601 timestamp of the soft-delete tombstone: when this project was soft-deleted.
   *  Absent = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   *  soft-delete requires prior archival, and a tombstone is hard-purged only after
   *  PURGE_MIN_AGE_DAYS — all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt?: ISOTimestamp;
}

export interface Phase extends ScopedEntity {
  name: string;
  projectId: ID;
}

export interface Activity extends ScopedEntity {
  name: string;
  /** What this activity is: project-specific work, internal work, or an all-projects activity. The
   *  discriminant the schedule's activity lens filters on. See {@link ActivityKind}. */
  kind: ActivityKind;
  /** Set ONLY for `kind: 'project'` — the project this activity belongs to. Internal and
   *  all-projects (`repeatable`) activities are project-less at the activity level; repeatable
   *  allocations may carry their own project attribution. */
  projectId?: ID;
  phaseId?: ID;
}

export interface Allocation extends ScopedEntity {
  resourceId: ID;
  activityId: ID;
  /** Set only for `repeatable`-activity allocations to attribute this booking to a project.
   *  Absent means unattributed; `project` and `internal` activities must not carry it. */
  projectId?: ID;
  /** System-owned identity shared by allocations created in one repeat batch. Absent = one-off or legacy repeat. */
  seriesId?: ID;
  startDate: ISODate; // inclusive
  endDate: ISODate; // inclusive
  hoursPerDay: number;
  status: AllocationStatus;
  note?: string;
  /** When true, this allocation treats weekends / non-working days as normal
   *  working days (drag/move does not auto-extend across them). Absent =
   *  weekend-aware (the default). */
  ignoreWeekends?: boolean;
  // future-additive (NOT built in v1): startTime?/endTime? for "9am–1pm" allocations
}

export interface TimeOff extends ScopedEntity {
  /** The resource taking personal time off. */
  resourceId: ID;
  startDate: ISODate; // inclusive
  endDate: ISODate; // inclusive
  type: TimeOffType;
  note?: string;
}

/** A literal inclusive span when the company is closed to people and placeholders. */
export interface Closure extends ScopedEntity {
  name: string;
  startDate: ISODate;
  endDate: ISODate;
}

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

/** Every logical AppData table, independent of persistence implementation. Keep this list in
 * dependency-neutral shape order; use APP_DATA_WRITE_ORDER when parent/child ordering matters. */
export const APP_DATA_KEYS = [
  "accounts",
  "disciplines",
  "resources",
  "clients",
  "projects",
  "phases",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly (keyof AppData)[];

export type AppDataKey = (typeof APP_DATA_KEYS)[number];

type MissingAppDataKey = Exclude<keyof AppData, AppDataKey>;
const appDataKeysAreComplete: MissingAppDataKey extends never ? true : never = true;
void appDataKeysAreComplete;

/** The AppData arrays holding account-scoped entities (everything except `accounts`). */
export type ScopedEntityKey = Exclude<AppDataKey, "accounts">;

export const SCOPED_KEYS = [
  "disciplines",
  "resources",
  "clients",
  "projects",
  "phases",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly ScopedEntityKey[];

type MissingScopedEntityKey = Exclude<ScopedEntityKey, (typeof SCOPED_KEYS)[number]>;
const scopedEntityKeysAreComplete: MissingScopedEntityKey extends never ? true : never = true;
void scopedEntityKeysAreComplete;

/** Parent-before-child order for writes; reverse it for child-before-parent deletion. This is a
 * domain relationship graph shared by the browser diff engine and SQLite adapter, not SQL DDL. */
export const APP_DATA_WRITE_ORDER = [
  "accounts",
  "clients",
  "disciplines",
  "projects",
  "phases",
  "resources",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly AppDataKey[];

/** Scoped subset of APP_DATA_WRITE_ORDER, retained as a named value because scope membership and
 * dependency order are different concepts (SCOPED_KEYS intentionally carries no ordering promise). */
export const SCOPED_WRITE_ORDER = [
  "clients",
  "disciplines",
  "projects",
  "phases",
  "resources",
  "activities",
  "allocations",
  "timeOff",
  "closures",
] as const satisfies readonly ScopedEntityKey[];

type MissingAppDataWriteKey = Exclude<AppDataKey, (typeof APP_DATA_WRITE_ORDER)[number]>;
const appDataWriteOrderIsComplete: MissingAppDataWriteKey extends never ? true : never = true;
void appDataWriteOrderIsComplete;

type MissingScopedWriteKey = Exclude<ScopedEntityKey, (typeof SCOPED_WRITE_ORDER)[number]>;
const scopedWriteOrderIsComplete: MissingScopedWriteKey extends never ? true : never = true;
void scopedWriteOrderIsComplete;

/** Upper bound for hours/day on a resource or allocation — a day can't hold more than
 *  24h. The single source of truth for the clamp applied on import, at the store write
 *  boundary, and after a drag-resize rescale. */
export const MAX_HOURS_PER_DAY = 24;

/** JSON/export format version. Bump when the portable AppData shape changes; drives
 *  data/migrate.ts and is deliberately independent of the server's physical SQLite version.
 *  (v4 added Activity.kind;
 *  v5 renamed the domain concept Task→Activity: the `tasks` table → `activities` and
 *  `Allocation.taskId` → `activityId`; v6 ensures every account has one built-in `Client`
 *  with `builtin: true` — the "Internal" pseudo-client; v7 adds optional client/project privacy
 *  fields, whose absent values already represent the public default; v8 adds the optional
 *  per-account Internal work colour mode, whose absence means grey; v9 adds the optional per-account
 *  schedule view prefs showInternalProjects / showInternalActivities / inlineActivityCreateEnabled,
 *  whose absence means shown/enabled — read at `?? true`; v10 adds optional Resource.isFavourite,
 *  whose absence means not favourite; v11 adds required Resource.halfDays, initially empty for
 *  legacy resources so every previously selected weekday remains a full day; v12 adds required
 *  Resource.engagement, defaulting legacy resources to Studio; v13 adds the optional account-wide
 *  groupResourcesByEngagement view preference, whose absence means enabled; v14 adds account-wide
 *  working days, defaulting legacy accounts to the first five days of their configured week; v15
 *  adds optional Allocation.seriesId without inferring links for legacy repeat batches; v16 widens
 *  TimeOff.resourceId to nullable, where null represents company-wide time off for Everyone; v17
 *  separates company closures into their own table and restores required TimeOff.resourceId; v18
 *  adds optional per-allocation project attribution for repeatable activities.) */
export const EXPORT_SCHEMA_VERSION = 18;

export interface PersistedState {
  schemaVersion: number;
  data: AppData;
  /** Legacy compare-and-swap revision retained for import compatibility. */
  revision?: number;
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
} from "./entityHelpers";
