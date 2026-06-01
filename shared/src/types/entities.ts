// Core domain types for Floaty. Pure data shapes — no behaviour lives here.

export type ID = string // crypto.randomUUID()
export type ISODate = string // date-only, "YYYY-MM-DD"
export type ISOTimestamp = string // full ISO datetime, e.g. new Date().toISOString()

/** 0 = Sunday … 6 = Saturday (matches JS Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type AllocationStatus = 'confirmed' | 'tentative' | 'completed'
/** How allocations are entered: by daily load against a fixed end date ('hourly',
 *  the default) or by volume of work spread over a span ('days'). */
export type SchedulingMode = 'hourly' | 'days'
export type ResourceKind = 'person' | 'placeholder'
export type EmploymentType = 'permanent' | 'freelancer' | 'contractor'
export type TimeOffType = 'holiday' | 'sick' | 'unpaid' | 'other'

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
  /** Optional: placeholders may be nameless (shown by `role`). */
  name?: string
  /** e.g. "Senior Designer" — the label used for nameless placeholders. */
  role: string
  disciplineId?: ID
  employmentType: EmploymentType
  workingHoursPerDay: number
  /** Working weekdays, e.g. [1,2,3,4,5] for Mon–Fri. */
  workingDays: Weekday[]
  /** PLACEHOLDERS ONLY: the single project a placeholder is bound to. */
  projectId?: ID
  color: string
}

export interface Client extends ScopedEntity {
  name: string
  color: string
}

export interface Project extends ScopedEntity {
  name: string
  clientId: ID // REQUIRED — a project must belong to a client
  color: string
}

export interface Phase extends ScopedEntity {
  name: string
  projectId: ID
}

export interface Task extends ScopedEntity {
  name: string
  /** Optional: a task may belong to a project, or be a general (no-project)
   *  reusable task (e.g. "Admin", "Internal review") allocated freely. */
  projectId?: ID
  phaseId?: ID
}

export interface Allocation extends ScopedEntity {
  resourceId: ID
  taskId: ID
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
  tasks: Task[]
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
  | 'tasks'
  | 'allocations'
  | 'timeOff'

export const SCOPED_KEYS: ScopedEntityKey[] = [
  'disciplines',
  'resources',
  'clients',
  'projects',
  'phases',
  'tasks',
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

/** Bump when the persisted shape changes; drives data/migrate.ts. */
export const SCHEMA_VERSION = 3

export interface PersistedState {
  schemaVersion: number
  data: AppData
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
    tasks: [],
    allocations: [],
    timeOff: [],
  }
}
