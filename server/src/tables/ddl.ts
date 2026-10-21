// The immutable v8 DDL anchors historical upgrades; later migrations own additions to the live schema.
// Foreign-key cascade behavior must stay aligned with shared domain transforms, as cascadeParity verifies.
// SET NULL does not advance survivor revisions, so lifecycle purge restamps unbound rows.
// Explicit NOT NULL is required on fresh text primary keys; older nullable primary keys remain supported through write validation.
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
`;

/** Installed after boot-time duplicate repair so existing databases can be reconciled first. */
export const INTERNAL_CLIENT_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS clients_one_builtin_per_account
ON clients(accountId) WHERE builtin = 'true';
`;
