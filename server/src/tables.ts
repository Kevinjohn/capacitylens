import type { ScopedEntityKey } from '@floaty/shared/types/entities'

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

const META: ColumnSpec[] = [{ name: 'createdAt' }, { name: 'updatedAt' }]

export const TABLES: Record<string, TableSpec> = {
  accounts: {
    key: 'accounts',
    columns: [{ name: 'id' }, { name: 'name' }, { name: 'color' }, ...META],
  },
  clients: {
    key: 'clients',
    columns: [{ name: 'id' }, { name: 'accountId' }, { name: 'name' }, { name: 'color' }, ...META],
  },
  disciplines: {
    key: 'disciplines',
    columns: [
      { name: 'id' },
      { name: 'accountId' },
      { name: 'name' },
      { name: 'color', optional: true },
      { name: 'sortOrder' },
      ...META,
    ],
  },
  projects: {
    key: 'projects',
    columns: [
      { name: 'id' },
      { name: 'accountId' },
      { name: 'name' },
      { name: 'clientId' },
      { name: 'color' },
      ...META,
    ],
  },
  phases: {
    key: 'phases',
    columns: [{ name: 'id' }, { name: 'accountId' }, { name: 'name' }, { name: 'projectId' }, ...META],
  },
  resources: {
    key: 'resources',
    columns: [
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
      ...META,
    ],
  },
  tasks: {
    key: 'tasks',
    columns: [
      { name: 'id' },
      { name: 'accountId' },
      { name: 'name' },
      { name: 'projectId', optional: true },
      { name: 'phaseId', optional: true },
      ...META,
    ],
  },
  allocations: {
    key: 'allocations',
    columns: [
      { name: 'id' },
      { name: 'accountId' },
      { name: 'resourceId' },
      { name: 'taskId' },
      { name: 'startDate' },
      { name: 'endDate' },
      { name: 'hoursPerDay' },
      { name: 'status' },
      { name: 'note', optional: true },
      ...META,
    ],
  },
  timeOff: {
    key: 'timeOff',
    columns: [
      { name: 'id' },
      { name: 'accountId' },
      { name: 'resourceId' },
      { name: 'startDate' },
      { name: 'endDate' },
      { name: 'type' },
      { name: 'note', optional: true },
      ...META,
    ],
  },
}

// Parent-before-child order for creates/updates. Deletes use the reverse so a child
// is always removed before its parent (and the DB's ON DELETE handles any overlap
// with the store's own cascade, which arrives as idempotent deletes).
export const CREATE_ORDER = [
  'accounts',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'tasks',
  'allocations',
  'timeOff',
] as const

export const SCOPED_ORDER: ScopedEntityKey[] = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'tasks',
  'allocations',
  'timeOff',
]

// DDL. Foreign keys mirror src/lib/integrity.ts cascade rules exactly:
//   resource → allocations/timeOff : CASCADE        (deleteResourceCascade)
//   task     → allocations          : CASCADE        (deleteTaskCascade)
//   phase    → tasks.phaseId         : SET NULL       (deletePhaseCascade: unbind)
//   project  → phases/tasks          : CASCADE        (deleteProjectCascade)
//   project  → resources.projectId   : SET NULL       (placeholder unbind)
//   client   → projects              : CASCADE        (deleteClientCascade)
//   discipline → resources.disciplineId : SET NULL    (deleteDisciplineCascade: ungroup)
//   account  → everything scoped     : CASCADE        (deleteAccountCascade)
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disciplines (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT, sortOrder INTEGER NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  color TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phases (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
  disciplineId TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
  employmentType TEXT NOT NULL, workingHoursPerDay REAL NOT NULL,
  workingDays TEXT NOT NULL,
  projectId TEXT REFERENCES projects(id) ON DELETE SET NULL,
  color TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  projectId TEXT REFERENCES projects(id) ON DELETE CASCADE,
  phaseId TEXT REFERENCES phases(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, hoursPerDay REAL NOT NULL,
  status TEXT NOT NULL, note TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timeOff (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, type TEXT NOT NULL, note TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
`
