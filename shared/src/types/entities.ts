// Core domain types for CapacityLens. Pure data shapes — no behaviour lives here.

export type ID = string // crypto.randomUUID()
export type ISODate = string // date-only, "YYYY-MM-DD"
export type ISOTimestamp = string // full ISO datetime, e.g. new Date().toISOString()

/** 0 = Sunday … 6 = Saturday (matches JS Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type AllocationStatus = 'confirmed' | 'tentative' | 'completed'
/** How allocations are entered: by daily load against a fixed end date ('hourly',
 *  the default), by volume of work spread over a span ('days'), or as a pure
 *  booking block where only the span matters and load is ignored ('blocks'). */
export type SchedulingMode = 'hourly' | 'days' | 'blocks'
/** Runtime list of the valid scheduling modes — the single source the server's
 *  sanitiser uses to reject a junk `schedulingMode` on a direct account write. */
export const SCHEDULING_MODES: SchedulingMode[] = ['hourly', 'days', 'blocks']
export const WEEK_STARTS_OPTIONS: Array<0 | 1> = [0, 1]
/**
 * What a resource row represents:
 * - `person`      — a real team member with capacity (the default).
 * - `placeholder` — an unfilled role/"slot", bound to one project (see `projectId`).
 * - `external`    — an outsourced 3rd-party company. Can be assigned activities, but has NO
 *   hours/capacity/utilisation and is EXCLUDED from all capacity math; it renders in its own
 *   band at the bottom of the schedule. Reuses `name` (company name, required by the form) +
 *   `role` (optional descriptor); its `workingHoursPerDay`/`workingDays` are unused silent
 *   defaults. Resolves the "third-party line" — see NEEDS-INPUT.md / DECISIONS.md.
 */
export type ResourceKind = 'person' | 'placeholder' | 'external'
export type EmploymentType = 'permanent' | 'freelancer' | 'contractor'
export type TimeOffType = 'holiday' | 'sick' | 'unpaid' | 'other'
/**
 * What an activity IS — the axis the schedule's "activity view" filters on. Three kinds:
 * - `project`    — belongs to one project (carries `projectId`, optionally a `phaseId`).
 * - `internal`   — project-less internal work (Admin, internal review/meeting).
 * - `repeatable` — project-less reusable activity used across many projects (Design, Workshop).
 * Coherence (enforced in assertScopedRefs, repaired on import): `project` HAS a `projectId`;
 * `internal`/`repeatable` have NEITHER `projectId` nor `phaseId`.
 */
export type ActivityKind = 'project' | 'internal' | 'repeatable'

/** Fields every persisted entity carries — cheap now, impossible to backfill later. */
export interface Entity {
  id: ID
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

/** A tenant. Top-level: not scoped to any other account. */
export interface Account extends Entity {
  name: string
  color: string
  /** How this company enters allocations. Absent = 'hourly' (the original behaviour). */
  schedulingMode?: SchedulingMode
  /** IANA time zone used to derive "today" for this account. Absent = 'Etc/GMT'. */
  timezone?: string
  /** Which weekday starts the week: 0 = Sunday, 1 = Monday. Absent = 1. */
  weekStartsOn?: 0 | 1
  /** UI language for this company. Absent = 'en'. English-only until P1.5.1 (Paraglide).
   *  Frozen after creation — see P1.14. */
  language?: string
  /** Whether this company uses disciplines. Absent = true (the original behaviour).
   *  When false, disciplines are hidden across the whole UI (nav, resource form,
   *  schedule grouping + filter, lists, command palette) — the data is preserved. */
  disciplinesEnabled?: boolean
  /** Whether this company surfaces placeholder ("slot") resources. Absent = false
   *  (hidden out of the box — NOT `?? true` like disciplinesEnabled) so new companies start
   *  with placeholders OFF. When false, placeholders are hidden across the UI; the data is
   *  preserved and returns when re-enabled. */
  placeholdersEnabled?: boolean
  /** Whether this company surfaces external / 3rd-party resources. Absent = false (hidden out
   *  of the box, like placeholdersEnabled) so new companies start with external OFF. When false,
   *  external resources are hidden across the UI; the data is preserved and returns when re-enabled. */
  externalEnabled?: boolean
}

/** Every domain entity belongs to exactly one account. Accounts themselves don't. */
export interface ScopedEntity extends Entity {
  accountId: ID
}

export interface Discipline extends ScopedEntity {
  name: string
  color?: string
  sortOrder: number // controls grouping order in the scheduler
}

export interface Resource extends ScopedEntity {
  kind: ResourceKind
  /** Optional: placeholders may be nameless (shown by `role`). For `external` this holds the
   *  COMPANY name (the External form requires it). */
  name?: string
  /** e.g. "Senior Designer" — the label used for nameless placeholders; an `external`'s
   *  optional descriptor (e.g. "Print", "Overflow dev"). */
  role: string
  disciplineId?: ID
  employmentType: EmploymentType
  /** Capacity per working day. Unused (silent default) for `external` — externals have no capacity. */
  workingHoursPerDay: number
  /** Working weekdays, e.g. [1,2,3,4,5] for Mon–Fri. */
  workingDays: Weekday[]
  /** PLACEHOLDERS ONLY: the single project a placeholder is bound to. */
  projectId?: ID
  color: string
  /** ISO 8601 timestamp of when this resource was archived (soft, reversible): hidden from
   *  scheduling but fully retained. Absent = active (not archived). Part of the
   *  Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   *  shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt?: ISOTimestamp
  /** ISO 8601 timestamp of the soft-delete tombstone: when this resource was soft-deleted.
   *  Absent = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   *  soft-delete requires prior archival, and a tombstone is hard-purged only after
   *  PURGE_MIN_AGE_DAYS — all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt?: ISOTimestamp
}

export interface Client extends ScopedEntity {
  name: string
  color: string
  /** True ONLY for the built-in "Internal" pseudo-client — exactly one per account, created by
   *  seed / addAccount / migrate. A built-in client cannot be renamed or deleted, and a project-less
   *  internal/repeatable activity buckets under it for display + filtering. Absent/false = a normal,
   *  user-managed client. Identified at runtime by THIS flag, never a hard-coded id (so it survives
   *  import-remap). See shared/src/data/internalClient.ts. */
  builtin?: boolean
  /** ISO 8601 timestamp of when this client was archived (soft, reversible): hidden from
   *  scheduling but fully retained. Absent = active (not archived). Part of the
   *  Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   *  shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt?: ISOTimestamp
  /** ISO 8601 timestamp of the soft-delete tombstone: when this client was soft-deleted.
   *  Absent = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   *  soft-delete requires prior archival, and a tombstone is hard-purged only after
   *  PURGE_MIN_AGE_DAYS — all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt?: ISOTimestamp
}

export interface Project extends ScopedEntity {
  name: string
  clientId: ID // REQUIRED — a project must belong to a client
  color: string
  /** ISO 8601 timestamp of when this project was archived (soft, reversible): hidden from
   *  scheduling but fully retained. Absent = active (not archived). Part of the
   *  Active→Archived→Soft-deleted→Purged lifecycle; set/cleared only by the state machine in
   *  shared/src/domain/lifecycle.ts. Non-active rows are hidden from normal views/reads (activeOnly). */
  archivedAt?: ISOTimestamp
  /** ISO 8601 timestamp of the soft-delete tombstone: when this project was soft-deleted.
   *  Absent = not deleted. Lifecycle invariant: a record may be archived without being deleted, but
   *  soft-delete requires prior archival, and a tombstone is hard-purged only after
   *  PURGE_MIN_AGE_DAYS — all enforced by shared/src/domain/lifecycle.ts. */
  deletedAt?: ISOTimestamp
}

export interface Phase extends ScopedEntity {
  name: string
  projectId: ID
}

export interface Activity extends ScopedEntity {
  name: string
  /** What this activity is: project work, internal, or a reusable (repeatable) activity. The
   *  discriminant the schedule's activity lens filters on. See {@link ActivityKind}. */
  kind: ActivityKind
  /** Set ONLY for `kind: 'project'` — the project this activity belongs to. Internal and
   *  repeatable activities are project-less (and so are their allocations). */
  projectId?: ID
  phaseId?: ID
}

export interface Allocation extends ScopedEntity {
  resourceId: ID
  activityId: ID
  startDate: ISODate // inclusive
  endDate: ISODate // inclusive
  hoursPerDay: number
  status: AllocationStatus
  note?: string
  /** When true, this allocation treats weekends / non-working days as normal
   *  working days (drag/move does not auto-extend across them). Absent =
   *  weekend-aware (the default). */
  ignoreWeekends?: boolean
  // future-additive (NOT built in v1): startTime?/endTime? for "9am–1pm" allocations
}

export interface TimeOff extends ScopedEntity {
  resourceId: ID
  startDate: ISODate // inclusive
  endDate: ISODate // inclusive
  type: TimeOffType
  note?: string
}

export interface AppData {
  accounts: Account[]
  disciplines: Discipline[]
  resources: Resource[]
  clients: Client[]
  projects: Project[]
  phases: Phase[]
  activities: Activity[]
  allocations: Allocation[]
  timeOff: TimeOff[]
}

/** The AppData arrays holding account-scoped entities (everything except `accounts`). */
export type ScopedEntityKey =
  | 'disciplines'
  | 'resources'
  | 'clients'
  | 'projects'
  | 'phases'
  | 'activities'
  | 'allocations'
  | 'timeOff'

export const SCOPED_KEYS: ScopedEntityKey[] = [
  'disciplines',
  'resources',
  'clients',
  'projects',
  'phases',
  'activities',
  'allocations',
  'timeOff',
]

/** A uniform `ScopedEntity[]` view of AppData's scoped tables. The SCOPED_KEYS
 *  loops (scope-to-account, cascade-delete, import) process every scoped table as
 *  the common supertype; this isolates into ONE named seam the single cast
 *  TypeScript can't infer through a heterogeneous-union index — replacing the
 *  scattered `as never` / `as unknown as` casts the loops used to need. */
export function scopedTables(data: AppData): Record<ScopedEntityKey, ScopedEntity[]> {
  return data as Record<ScopedEntityKey, ScopedEntity[]>
}

/** Upper bound for hours/day on a resource or allocation — a day can't hold more than
 *  24h. The single source of truth for the clamp applied on import, at the store write
 *  boundary, and after a drag-resize rescale. */
export const MAX_HOURS_PER_DAY = 24

/** Clamp an ALLOCATION's hours/day into [0, MAX_HOURS_PER_DAY]; a non-finite value → 0. The
 *  ONE rule shared by the store write boundary (every allocation write) and the import
 *  sanitiser, so the two can never drift. 0 is legal (a 'blocks' booking carries 0 load);
 *  a day can't exceed 24h. */
export function clampHoursPerDay(h: number): number {
  return Number.isFinite(h) ? Math.max(0, Math.min(h, MAX_HOURS_PER_DAY)) : 0
}

/** Clamp a RESOURCE's working hours/day to (0, MAX_HOURS_PER_DAY]. Unlike an allocation, a
 *  resource must work a POSITIVE number of hours (0 capacity = no working day at all — same
 *  reason the store rejects an empty working-week), so junk / <= 0 falls back to a normal 8h
 *  day; a finite positive value just clamps to the 24h ceiling. Shared by the import sanitiser
 *  and the store resource write path so the two stay in lockstep. */
export function clampWorkingHoursPerDay(h: number): number {
  return Number.isFinite(h) && h > 0 ? Math.min(h, MAX_HOURS_PER_DAY) : 8
}

/** Outsourced / 3rd-party resources have NO capacity (no hours, utilisation, or over-markers) and
 *  render in their own neutral band. This is the SINGLE predicate every capacity surface gates on —
 *  so a new capacity-free kind is a one-line change here, not N scattered `kind === 'external'`
 *  checks across the scheduler / forms / import. */
export function isExternalResource(r: { kind: ResourceKind }): boolean {
  return r.kind === 'external'
}
/** Inverse of {@link isExternalResource} — true when a resource participates in capacity/utilisation. */
export function isCapacityTracked(r: { kind: ResourceKind }): boolean {
  return !isExternalResource(r)
}

/** The unused silent-default capacity fields every `external` resource is created with: externals
 *  have no capacity, but the Resource type + store still require a positive working day and a
 *  non-empty week. A FACTORY (not a shared object) so each call gets its own `workingDays` array —
 *  no aliasing if a consumer mutates it. One source for the External form, seed, and fixtures. */
export function externalCapacityDefaults(): Pick<Resource, 'employmentType' | 'workingHoursPerDay' | 'workingDays'> {
  return { employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5] }
}

/** Bump when the persisted shape changes; drives data/migrate.ts. (v4 added Activity.kind;
 *  v5 renamed the domain concept Task→Activity: the `tasks` table → `activities` and
 *  `Allocation.taskId` → `activityId`; v6 ensures every account has one built-in `Client`
 *  with `builtin: true` — the "Internal" pseudo-client.) */
export const SCHEMA_VERSION = 6

export interface PersistedState {
  schemaVersion: number
  data: AppData
  /** Monotonic localStorage compare-and-swap revision (absent on legacy/export blobs). */
  revision?: number
}

/** A fresh, empty dataset — the starting point before seeding. */
export function emptyAppData(): AppData {
  return {
    accounts: [],
    disciplines: [],
    resources: [],
    clients: [],
    projects: [],
    phases: [],
    activities: [],
    allocations: [],
    timeOff: [],
  }
}

/** True when every AppData table is an empty array — a genuinely empty dataset (a
 *  first run or a fully-cleared store). The single definition shared by the client
 *  bootstrap (src/data/persist.ts) and the server's init-marker backfill
 *  (server/src/db.ts) so the two "is this empty?" checks can never drift. */
export function isEmpty(data: AppData): boolean {
  return Object.values(data).every((v) => Array.isArray(v) && v.length === 0)
}
