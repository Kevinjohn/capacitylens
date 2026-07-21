import type {
  Account,
  Allocation,
  Client,
  Discipline,
  Phase,
  Project,
  Resource,
  Activity,
  TimeOff,
} from '@capacitylens/shared/types/entities'
import { APP_DATA_WRITE_ORDER, SCOPED_WRITE_ORDER } from '@capacitylens/shared/types/entities'

// The single source of truth for the SQL schema and the row<->object mapping. One
// entry per AppData table. `columns` is the exact column order used for INSERT and
// for reading rows back. `json` columns are JSON.stringify'd on write / parsed on
// read; `optional` columns are stored NULL when absent and omitted (not null) when
// read back, so a round-tripped row deep-equals the client's object.

export interface ColumnSpec {
  name: string
  json?: boolean
  optional?: boolean
}

export interface TableSpec {
  /** AppData key === REST path segment (e.g. 'timeOff' → /api/timeOff). */
  key: string
  columns: ColumnSpec[]
}

// Type-level exhaustiveness guard for a table's column list: every key of the
// entity type must appear exactly once, and every listed name must be a valid key.
// Usage: `_checkColumns<Account>(COLS_accounts)` — fails to compile the moment a
// field is added to the entity type but omitted from the column spec (or vice versa).
type CheckColumns<E, Cols extends readonly ColumnSpec[]> =
  // Forward: every listed name must be a key of E
  Cols[number]['name'] extends keyof E
    // Reverse: every key of E must be covered by the listed names
    ? Exclude<keyof E, Cols[number]['name']> extends never
      ? true
      : never
    : never

// One check-variable per table. Type is `true` when the columns match the entity
// perfectly; `never` (compile error) when they drift.
/* eslint-disable @typescript-eslint/no-unused-vars */
declare const _checkAccounts: CheckColumns<Account, typeof COLS_accounts>
declare const _checkClients: CheckColumns<Client, typeof COLS_clients>
declare const _checkDisciplines: CheckColumns<Discipline, typeof COLS_disciplines>
declare const _checkProjects: CheckColumns<Project, typeof COLS_projects>
declare const _checkPhases: CheckColumns<Phase, typeof COLS_phases>
declare const _checkResources: CheckColumns<Resource, typeof COLS_resources>
declare const _checkActivities: CheckColumns<Activity, typeof COLS_activities>
declare const _checkAllocations: CheckColumns<Allocation, typeof COLS_allocations>
declare const _checkTimeOff: CheckColumns<TimeOff, typeof COLS_timeOff>
/* eslint-enable @typescript-eslint/no-unused-vars */

const META = [{ name: 'createdAt' }, { name: 'updatedAt' }] as const

const COLS_accounts = [
  { name: 'id' },
  { name: 'name' },
  { name: 'color' },
  { name: 'schedulingMode', optional: true },
  { name: 'timezone', optional: true },
  { name: 'weekStartsOn', json: true, optional: true },
  { name: 'language', optional: true },
  { name: 'disciplinesEnabled', json: true, optional: true },
  { name: 'placeholdersEnabled', json: true, optional: true },
  { name: 'externalEnabled', json: true, optional: true },
  { name: 'internalColourMode', optional: true },
  // Optional schedule view prefs (default true — shown/enabled). JSON so node:sqlite round-trips the
  // boolean as "true"/"false"; absent → NULL → omitted on read, matching the client object.
  { name: 'showInternalProjects', json: true, optional: true },
  { name: 'showInternalActivities', json: true, optional: true },
  { name: 'inlineActivityCreateEnabled', json: true, optional: true },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_clients = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'name' },
  { name: 'color' },
  // Optional privacy pair: absent = public. Stored code names exclude display quotation marks.
  { name: 'isPrivate', json: true, optional: true },
  { name: 'codeName', optional: true },
  // JSON so node:sqlite (which can't bind a raw boolean) round-trips it as "true"/"false";
  // absent → NULL → omitted on read, matching the client object. True only for the built-in
  // Internal pseudo-client (one per account).
  { name: 'builtin', json: true, optional: true },
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: 'archivedAt', optional: true },
  { name: 'deletedAt', optional: true },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_disciplines = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'name' },
  { name: 'color', optional: true },
  { name: 'sortOrder' },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_projects = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'name' },
  { name: 'clientId' },
  { name: 'color' },
  // Optional privacy pair: absent = public. Stored code names exclude display quotation marks.
  { name: 'isPrivate', json: true, optional: true },
  { name: 'codeName', optional: true },
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: 'archivedAt', optional: true },
  { name: 'deletedAt', optional: true },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_phases = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'name' },
  { name: 'projectId' },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_resources = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'kind' },
  { name: 'name', optional: true },
  { name: 'role' },
  { name: 'disciplineId', optional: true },
  { name: 'employmentType' },
  { name: 'workingHoursPerDay' },
  { name: 'workingDays', json: true },
  { name: 'projectId', optional: true },
  { name: 'color' },
  // Lifecycle timestamps (P2.1) — plain TEXT, absent → NULL → omitted on read. Inert plumbing today.
  { name: 'archivedAt', optional: true },
  { name: 'deletedAt', optional: true },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_activities = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'name' },
  { name: 'kind' },
  { name: 'projectId', optional: true },
  { name: 'phaseId', optional: true },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_allocations = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'resourceId' },
  { name: 'activityId' },
  { name: 'startDate' },
  { name: 'endDate' },
  { name: 'hoursPerDay' },
  { name: 'status' },
  { name: 'note', optional: true },
  // JSON so node:sqlite (which can't bind a raw boolean) round-trips it as
  // "true"/"false"; absent → NULL → omitted on read, matching the client object.
  { name: 'ignoreWeekends', json: true, optional: true },
  ...META,
] as const satisfies ColumnSpec[]

const COLS_timeOff = [
  { name: 'id' },
  { name: 'accountId' },
  { name: 'resourceId' },
  { name: 'startDate' },
  { name: 'endDate' },
  { name: 'type' },
  { name: 'note', optional: true },
  ...META,
] as const satisfies ColumnSpec[]

export const TABLES: Record<string, TableSpec> = {
  accounts: {
    key: 'accounts',
    columns: COLS_accounts,
  },
  clients: {
    key: 'clients',
    columns: COLS_clients,
  },
  disciplines: {
    key: 'disciplines',
    columns: COLS_disciplines,
  },
  projects: {
    key: 'projects',
    columns: COLS_projects,
  },
  phases: {
    key: 'phases',
    columns: COLS_phases,
  },
  resources: {
    key: 'resources',
    columns: COLS_resources,
  },
  activities: {
    key: 'activities',
    columns: COLS_activities,
  },
  allocations: {
    key: 'allocations',
    columns: COLS_allocations,
  },
  timeOff: {
    key: 'timeOff',
    columns: COLS_timeOff,
  },
}

// Parent-before-child order for creates/updates. Deletes use the reverse so a child
// is always removed before its parent (and the DB's ON DELETE handles any overlap
// with the store's own cascade, which arrives as idempotent deletes).
export const CREATE_ORDER = APP_DATA_WRITE_ORDER
export const SCOPED_ORDER = SCOPED_WRITE_ORDER

// DDL. Foreign keys mirror src/lib/integrity.ts cascade rules exactly:
//   resource → allocations/timeOff : CASCADE        (deleteResourceCascade)
//   activity     → allocations          : CASCADE        (deleteActivityCascade)
//   phase    → activities.phaseId         : SET NULL       (deletePhaseCascade: unbind)
//   project  → phases/activities          : CASCADE        (deleteProjectCascade)
//   project  → resources.projectId   : SET NULL       (placeholder unbind)
//   client   → projects              : CASCADE        (deleteClientCascade)
//   discipline → resources.disciplineId : SET NULL    (deleteDisciplineCascade: ungroup)
//   account  → everything scoped     : CASCADE        (deleteAccountCascade)
//
// id columns are declared NOT NULL here for fresh databases. Existing databases are
// NOT rebuilt to add NOT NULL to the PK — a table-rebuild for all 9 tables is
// disproportionate, and assertSchemaCurrent already exempts `id` from its nullability
// check (SQLite PRAGMA reports notnull=0 for TEXT PRIMARY KEY regardless of the DDL,
// so the spec and live DB would always appear to disagree). The route-level
// assertIdPresent() in sanitizeWrite is the universal guard for all write paths.
/** Immutable schema text checksummed by the released v8 baseline migration. Do not edit. */
export const SCHEMA_V8_SQL = `
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  schedulingMode TEXT, timezone TEXT, weekStartsOn TEXT, language TEXT, disciplinesEnabled TEXT,
  placeholdersEnabled TEXT, externalEnabled TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, isPrivate TEXT, codeName TEXT, builtin TEXT,
  archivedAt TEXT, deletedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disciplines (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT, sortOrder INTEGER NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  color TEXT NOT NULL, isPrivate TEXT, codeName TEXT,
  archivedAt TEXT, deletedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phases (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
  disciplineId TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
  employmentType TEXT NOT NULL, workingHoursPerDay REAL NOT NULL,
  workingDays TEXT NOT NULL,
  projectId TEXT REFERENCES projects(id) ON DELETE SET NULL,
  color TEXT NOT NULL,
  archivedAt TEXT, deletedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  projectId TEXT REFERENCES projects(id) ON DELETE CASCADE,
  phaseId TEXT REFERENCES phases(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  activityId TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, hoursPerDay REAL NOT NULL,
  status TEXT NOT NULL, note TEXT, ignoreWeekends TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timeOff (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, type TEXT NOT NULL, note TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
`

/** Current fresh-schema reference. Physical upgrades still run the immutable v8 DDL followed by
 * explicit migrations, so this string is for current-shape assertions/documentation rather than a
 * shortcut around the ledger. */
export const SCHEMA_SQL = SCHEMA_V8_SQL.replace(
  'placeholdersEnabled TEXT, externalEnabled TEXT,',
  'placeholdersEnabled TEXT, externalEnabled TEXT, internalColourMode TEXT, ' +
    'showInternalProjects TEXT, showInternalActivities TEXT, inlineActivityCreateEnabled TEXT,',
)

/** Installed after boot-time duplicate repair so existing databases can be reconciled first. */
export const INTERNAL_CLIENT_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS clients_one_builtin_per_account
ON clients(accountId) WHERE builtin = 'true';
`
