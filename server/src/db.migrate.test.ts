import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmodSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  CAPACITYLENS_APPLICATION_ID,
  DATABASE_MIGRATION_TABLE,
  DB_SCHEMA_VERSION,
  deleteRow,
  getRow,
  initializeOpenDb,
  insertRow,
  isEmpty,
  isInitialized,
  loadState,
  openDb,
  openDbConnection,
  planDatabaseMigrations,
  seedIfUninitialized,
  V13_DEFINITION,
  V13_FROZEN_PRESET_COLORS,
  type Db,
} from "./db";
import { seed } from "@capacitylens/shared/data/seed";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { PRESET_COLORS, snapToPresetColor } from "@capacitylens/shared/lib/color";
import { createInvite, listInvitesForAccount, upsertMember, USED_INVITATION_RETENTION_LIMIT } from "./controlTables";
import { authFromEnv, runAuthMigrations } from "./auth";
import { TABLES } from "./tables";
import { assertMigrationValuesPreserved, captureMigrationValues } from "./migrationPreservation";
import {
  FOREIGN_KEY_CHILD_INDEXES_V23,
  TENANT_ENTITY_ACCOUNT_INDEXES_V21,
  TENANT_ENTITY_INDEXES_V21_SQL,
  assertTenantEntityIndexesCurrent,
} from "./tenantIndexes";

// openDb only ran CREATE TABLE IF NOT EXISTS, so a file written by an older schema
// kept its old columns/constraints forever and broke after a model change. These
// tests synthesize such an old file BY HAND and prove openDb's migrateSchema upgrades
// it in place. (A normal e2e/fresh run never exercises this — a new DB already has the
// current shape, so the migration is a no-op there and would give false confidence.)

const TS = "2026-01-01T00:00:00.000Z";
const fixture = (name: string): string => join(process.cwd(), "src", "fixtures", "databases", name);
const RELEASED_FIXTURE_VERSIONS = [7, 8, 9, 12, 13, 14, 15, 16, 23] as const;
const RELEASED_FIXTURE_NAMES = RELEASED_FIXTURE_VERSIONS.flatMap((version) => [
  `v${version}-off.db`,
  `v${version}-password.db`,
]);
const FIXTURE_PASSWORD_ENV = {
  NODE_ENV: "test",
  CAPACITYLENS_AUTH: "password",
  BETTER_AUTH_SECRET: "fixture-secret-0123456789abcdef-012345",
  BETTER_AUTH_URL: "http://localhost:8787",
} as const;

function copyFixture(name: string): { path: string; cleanup: () => void } {
  const path = join(tmpdir(), `capacitylens-${name}-${process.pid}-${Date.now()}.db`);
  const cleanup = () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(path + suffix);
      } catch {
        /* not present */
      }
    }
  };
  cleanup();
  copyFileSync(fixture(name), path);
  return { path, cleanup };
}

function normalizeSchemaSql(sql: string | null): string | null {
  if (!sql) return sql;
  const normalized = sql.replace(/\s+/g, " ").trim();
  const opening = normalized.indexOf("(");
  const closing = normalized.lastIndexOf(")");
  if (opening < 0 || closing < opening) return normalized;

  const definitions: string[] = [];
  const body = normalized.slice(opening + 1, closing);
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      definitions.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  definitions.push(body.slice(start).trim());
  return `${normalized.slice(0, opening).trim()} (${definitions.sort().join(", ")})${normalized.slice(closing + 1)}`;
}

const schemaFingerprint = (db: DatabaseSync): unknown[] =>
  (
    db
      .prepare(
        `
    SELECT type, name, tbl_name, sql
      FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
       AND type IN ('table', 'index', 'trigger')
     ORDER BY type, name
  `,
      )
      .all() as Array<{
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    }>
  ).map((entry) => ({ ...entry, sql: normalizeSchemaSql(entry.sql) }));

// The shape as it shipped BEFORE the Task→Activity rename (and before general tasks +
// scheduling modes): the table was `tasks` (projectId NOT NULL), the allocation FK was
// `taskId`, accounts had no schedulingMode, allocations had no ignoreWeekends. Kept verbatim
// here on purpose — this fixture IS a legacy DB, so openDb must rename it (tasks→activities,
// taskId→activityId) AND rebuild it. Only the drifted/parent tables are created; openDb's
// CREATE TABLE IF NOT EXISTS fills in the rest (disciplines/phases/resources/timeOff) current.
const OLD_SCHEMA = `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE clients (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phaseId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE allocations (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resourceId TEXT NOT NULL, taskId TEXT NOT NULL,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, hoursPerDay REAL NOT NULL,
  status TEXT NOT NULL, note TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
`;

function writeOldDb(path: string): void {
  const old = new DatabaseSync(path);
  old.exec(OLD_SCHEMA);
  old.exec(`
    INSERT INTO accounts VALUES ('a1','Studio','#111','${TS}','${TS}');
    INSERT INTO clients  VALUES ('c1','a1','Acme','#222','${TS}','${TS}');
    INSERT INTO projects VALUES ('p1','a1','Web','c1','#333','${TS}','${TS}');
    INSERT INTO tasks    VALUES ('t1','a1','Existing task','p1',NULL,'${TS}','${TS}');
  `);
  old.close();
}

/** Released CapacityLens databases carry the account→client→project→work chain. Focused drift
 * fixtures reproduce that legacy fingerprint so discriminator coverage remains independent from
 * the particular account-column drift each test is exercising. */
function addLegacyCompanionTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE clients (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL, clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      phaseId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE resources (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, name TEXT, role TEXT NOT NULL,
      disciplineId TEXT REFERENCES disciplines(id) ON DELETE SET NULL,
      employmentType TEXT NOT NULL, workingHoursPerDay REAL NOT NULL, workingDays TEXT NOT NULL,
      projectId TEXT REFERENCES projects(id) ON DELETE SET NULL, color TEXT NOT NULL,
      archivedAt TEXT, deletedAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE allocations (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      startDate TEXT NOT NULL, endDate TEXT NOT NULL, hoursPerDay REAL NOT NULL,
      status TEXT NOT NULL, note TEXT, ignoreWeekends TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
  `);
}

function addLegacyDisciplineTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE disciplines (
    id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sortOrder INTEGER NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );`);
}

function mutateCurrentDatabase(
  label: string,
  mutate: (db: DatabaseSync) => void,
): { path: string; cleanup: () => void } {
  const path = join(tmpdir(), `capacitylens-${label}-${process.pid}-${Date.now()}.db`);
  const cleanup = () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(path + suffix);
      } catch {
        /* not present */
      }
    }
  };
  cleanup();
  try {
    const current = openDb(path);
    current.close();
    const raw = new DatabaseSync(path);
    try {
      raw.exec("PRAGMA foreign_keys = OFF");
      mutate(raw);
    } finally {
      raw.close();
    }
    return { path, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function replaceEntityTable(db: DatabaseSync, table: string, transform: (sql: string) => string): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
    { sql: string } | undefined;
  if (!row) throw new Error(`Test fixture is missing table ${table}.`);
  db.exec(`DROP TABLE ${table}; ${transform(row.sql)}`);
}

function dropTenantEntityIndexes(db: DatabaseSync): void {
  for (const { index } of TENANT_ENTITY_ACCOUNT_INDEXES_V21) db.exec(`DROP INDEX ${index}`);
}

describe("schema migration of an existing on-disk DB", () => {
  it("pins synchronous FULL even when the connection inherited a weaker setting", () => {
    const copied = copyFixture("v16-off.db");
    const db = openDbConnection(copied.path);
    db.exec("PRAGMA synchronous = OFF");

    initializeOpenDb(db, copied.path);

    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    expect((db.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous).toBe(2);
    db.close();
    copied.cleanup();
  });

  it("retains both auth shapes for every top-level database schema that shipped", () => {
    const committed = readdirSync(join(process.cwd(), "src", "fixtures", "databases"))
      .filter((name) => name.endsWith(".db"))
      .sort();
    expect(committed).toEqual([...RELEASED_FIXTURE_NAMES].sort());
  });

  it("restricts the database and all live SQLite sidecars to owner read/write", () => {
    const path = join(tmpdir(), `capacitylens-mode-${process.pid}-${Date.now()}.db`);
    try {
      const db = openDb(path);
      insertRow(db, "accounts", {
        id: "a-mode",
        name: "Mode",
        color: "#111111",
        createdAt: TS,
        updatedAt: TS,
      });
      // Prove openDb repairs a permissive pre-existing database as well as creating secure files.
      chmodSync(path, 0o666);
      db.close();
      const reopened = openDb(path);
      const liveFiles = [path, `${path}-wal`, `${path}-shm`, `${path}-journal`].filter(existsSync);
      expect(liveFiles).toContain(`${path}-wal`);
      expect(liveFiles).toContain(`${path}-shm`);
      for (const file of liveFiles) expect(statSync(file).mode & 0o777).toBe(0o600);
      reopened.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    }
  });

  it("folds duplicate Internal clients before installing the singleton index", () => {
    const copied = copyFixture("v7-off.db");
    try {
      const legacy = openDbConnection(copied.path);
      legacy.exec(`
        DROP INDEX IF EXISTS clients_one_builtin_per_account;
        INSERT INTO accounts (id, name, color, createdAt, updatedAt)
          VALUES ('a1', 'Studio', '#111111', '${TS}', '${TS}');
        INSERT INTO clients (id, accountId, name, color, builtin, createdAt, updatedAt)
          VALUES ('internal:a1', 'a1', 'Internal', '#9c3ace', 'true', '${TS}', '${TS}'),
                 ('legacy-internal', 'a1', 'Internal', '#9c3ace', 'true',
                  '2025-01-01T00:00:00.000Z', '${TS}');
        INSERT INTO projects (id, accountId, clientId, name, color, createdAt, updatedAt)
          VALUES ('p1', 'a1', 'legacy-internal', 'Legacy', '#111111', '${TS}', '${TS}');
      `);
      const originalValues = captureMigrationValues(legacy);
      legacy.close();

      const repaired = openDb(copied.path);
      assertMigrationValuesPreserved(originalValues, captureMigrationValues(repaired), 7);
      const state = loadState(repaired);
      expect(state.clients.filter((client) => client.accountId === "a1" && client.builtin)).toHaveLength(1);
      expect(state.clients.find((client) => client.accountId === "a1" && client.builtin)?.id).toBe("internal:a1");
      expect(state.projects.find((project) => project.id === "p1")?.clientId).toBe("internal:a1");
      expect(() =>
        insertRow(repaired, "clients", {
          id: "another-internal",
          accountId: "a1",
          name: "Internal",
          color: "#9c3ace",
          builtin: true,
          createdAt: TS,
          updatedAt: TS,
        }),
      ).toThrow(/unique/i);
      repaired.close();
    } finally {
      copied.cleanup();
    }
  });

  it("mints a collision-free Internal id when a legacy ordinary client owns the generated id", () => {
    const copied = copyFixture("v7-off.db");
    try {
      const legacy = openDbConnection(copied.path);
      legacy.exec(`
        INSERT INTO accounts (id, name, color, createdAt, updatedAt)
          VALUES ('a1', 'Studio', '#111111', '${TS}', '${TS}');
        INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt)
          VALUES ('internal:a1', 'a1', 'Ordinary', '#111111', '${TS}', '${TS}');
      `);
      const originalValues = captureMigrationValues(legacy);
      legacy.close();

      const repaired = openDb(copied.path);
      assertMigrationValuesPreserved(originalValues, captureMigrationValues(repaired), 7);
      const clients = loadState(repaired).clients.filter(({ accountId }) => accountId === "a1");
      expect(clients).toHaveLength(2);
      expect(new Set(clients.map(({ id }) => id)).size).toBe(2);
      expect(clients.find(({ builtin }) => builtin === true)?.id).toBe("internal:a1:1");
      expect(clients.find(({ builtin }) => builtin !== true)?.id).toBe("internal:a1");
      repaired.close();
    } finally {
      copied.cleanup();
    }
  });

  it("v13 snaps every legacy non-preset account colour to its nearest preset exactly once, leaving preset colours untouched", () => {
    // Before v13, sanitizeWrite('accounts') replaced ANY non-preset stored colour with one FIXED
    // fallback hex on every write, and no migration ever repaired the rows already on disk — so a
    // legacy account's colour would silently flip to that one fixed colour the next time its row
    // was touched. This proves the v13 data repair snaps it to its NEAREST preset instead, runs
    // exactly once (idempotent DB migration ledger), and leaves an already-preset colour alone.
    const path = join(tmpdir(), `capacitylens-migrate-colour-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    };
    cleanup();
    try {
      const db = openDb(path); // fresh DB: already at the current version (v13 is a no-op here)
      // #7cd9e4 is not a preset — its nearest preset is #7adae3 (see shared color.test.ts for the
      // same fixture, pinned there against the full palette).
      insertRow(db, "accounts", {
        id: "a-legacy",
        name: "Legacy",
        color: "#7cd9e4",
        createdAt: TS,
        updatedAt: TS,
      });
      // Already a preset colour — must round-trip byte-identical, not get re-snapped to itself
      // via some other path that could reformat it.
      insertRow(db, "accounts", {
        id: "a-preset",
        name: "Already preset",
        color: "#e02727",
        createdAt: TS,
        updatedAt: TS,
      });
      // Roll the ledger back to "just before v13" (mirrors the v7 rollback other tests use, but only
      // a couple of steps back) so the next openDb() re-runs the v13 migration against these rows.
      // Every row past v12 must go: a leftover future-version ledger row would (rightly) fail the
      // exact-history assertion for user_version = 12.
      db.exec(`DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version > 12`);
      db.exec(`PRAGMA user_version = 12`);
      db.close();

      const upgraded = openDb(path);
      const state = loadState(upgraded);
      expect(state.accounts.find((a) => a.id === "a-legacy")?.color).toBe("#7adae3");
      expect(state.accounts.find((a) => a.id === "a-preset")?.color).toBe("#e02727");
      const history = upgraded
        .prepare(`SELECT version, name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 13`)
        .get() as { version: number; name: string } | undefined;
      expect(history).toEqual({
        version: 13,
        name: "snap-legacy-account-colors",
      });
      upgraded.close();

      // Idempotent: reopening an already-migrated DB plans no further migrations and leaves the
      // now-repaired colours untouched (the write-time guard is a no-op for already-migrated data).
      const reopened = openDb(path);
      expect(planDatabaseMigrations(reopened).migrations).toEqual([]);
      const restate = loadState(reopened);
      expect(restate.accounts.find((a) => a.id === "a-legacy")?.color).toBe("#7adae3");
      expect(restate.accounts.find((a) => a.id === "a-preset")?.color).toBe("#e02727");
      reopened.close();
    } finally {
      cleanup();
    }
  });

  it("preserves v13's released malformed-colour outcomes without changing its ledger definition", () => {
    const copied = copyFixture("v12-off.db");
    try {
      const legacy = new DatabaseSync(copied.path);
      legacy.prepare(`UPDATE accounts SET color = ? WHERE id = ?`).run("#1z2z3z", "a-studio");
      legacy.prepare(`UPDATE accounts SET color = ? WHERE id = ?`).run("12#3456", "a-loft");
      legacy.close();

      // The current exact mapper rejects both malformed shapes. Released migration v13 cannot be
      // edited to match it: that would invalidate its checksum and make identical v12 files upgrade
      // differently depending on server release.
      expect(snapToPresetColor("#1z2z3z")).toBe("#5c34d4");
      expect(snapToPresetColor("12#3456")).toBe("#5c34d4");

      const upgraded = openDb(copied.path);
      expect(upgraded.prepare(`SELECT id, color FROM accounts ORDER BY id`).all()).toEqual([
        { id: "a-loft", color: "#1b4f98" },
        { id: "a-studio", color: "#684327" },
      ]);
      expect(upgraded.prepare(`SELECT name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 13`).get()).toEqual({
        name: "snap-legacy-account-colors",
      });
      upgraded.close();
    } finally {
      copied.cleanup();
    }
  });

  it("v14 revokes an outstanding reset ceremony for a non-owner active member, leaving the membership row untouched", () => {
    // v12 revoked ceremonies for active OWNERS only, so a co-owner the v10-era raw-SQL repairs
    // demoted to admin kept any reset link minted while they still held Owner privilege. v14 is the
    // blanket every-active-member repair (the original v11 destroyed the role history a targeted
    // revocation would need — see migrateMemberResetCeremoniesV14). This drives it through the real
    // ledger/openDb path: the admin's link is burned, the membership row itself is not modified.
    const path = join(tmpdir(), `capacitylens-migrate-v14-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    };
    cleanup();
    try {
      const db = openDb(path); // fresh DB: already at the current version (v14 is a no-op here)
      insertRow(db, "accounts", {
        id: "a1",
        name: "Studio",
        color: "#e02727",
        createdAt: TS,
        updatedAt: TS,
      });
      upsertMember(db, {
        accountId: "a1",
        userId: "kept-owner",
        role: "owner",
        status: "active",
        createdAt: TS,
      });
      upsertMember(db, {
        accountId: "a1",
        userId: "demoted-admin",
        role: "admin",
        status: "active",
        createdAt: TS,
      });
      // Better Auth normally creates `verification` when password auth first runs; mirror that shape
      // (as controlTables.test.ts does) AFTER the membership writes, so upsertMember's own
      // privilege-change revocation cannot be what removes the token — only v14 can.
      db.exec(`CREATE TABLE verification (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run("demoted-reset", "demoted-admin");
      // Roll the ledger back to "just before v14" so the next openDb() re-runs ONLY the v14 migration.
      db.exec(`DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 14`);
      db.exec(`PRAGMA user_version = 13`);
      db.close();

      const upgraded = openDb(path);
      expect(upgraded.prepare(`SELECT id FROM verification`).all()).toEqual([]);
      expect(
        upgraded.prepare(`SELECT role, status, createdAt FROM account_members WHERE userId = ?`).get("demoted-admin"),
      ).toEqual({ role: "admin", status: "active", createdAt: TS });
      expect(
        upgraded.prepare(`SELECT version, name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 14`).get(),
      ).toEqual({ version: 14, name: "revoke-member-reset-ceremonies" });
      expect(
        (
          upgraded.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(DB_SCHEMA_VERSION);
      upgraded.close();

      // Idempotent: reopening an already-migrated DB plans no further migrations.
      const reopened = openDb(path);
      expect(planDatabaseMigrations(reopened).migrations).toEqual([]);
      reopened.close();
    } finally {
      cleanup();
    }
  });

  it("v16 adds the account view-pref columns via the explicit ledger step, leaving existing rows untouched", () => {
    // Drive migration 16 in ISOLATION through the real ledger/openDb path: take a current DB, simulate
    // a pre-v16 shape (drop the three columns + roll the ledger back to 15), then reopen and prove the
    // migration re-adds them, preserves the pre-existing row, and is idempotent on a second boot.
    const path = join(tmpdir(), `capacitylens-migrate-v16-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    };
    cleanup();
    try {
      const db = openDb(path); // fresh DB: already current (v16 columns present)
      insertRow(db, "accounts", {
        id: "a1",
        name: "Studio",
        color: "#e02727",
        createdAt: TS,
        updatedAt: TS,
      });
      for (const column of ["showInternalProjects", "showInternalActivities", "inlineActivityCreateEnabled"]) {
        db.exec(`ALTER TABLE accounts DROP COLUMN ${column}`);
      }
      db.exec(`DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 16`);
      db.exec(`PRAGMA user_version = 15`);
      db.close();

      const upgraded = openDb(path);
      const cols = (
        upgraded.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      expect(cols).toEqual(
        expect.arrayContaining(["showInternalProjects", "showInternalActivities", "inlineActivityCreateEnabled"]),
      );
      // The pre-existing account survived untouched; the newly-added columns read back absent.
      const acct = getRow(upgraded, "accounts", "a1");
      expect(acct?.name).toBe("Studio");
      expect(acct?.showInternalProjects).toBeUndefined();
      expect(acct?.showInternalActivities).toBeUndefined();
      expect(acct?.inlineActivityCreateEnabled).toBeUndefined();
      expect(
        upgraded.prepare(`SELECT version, name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 16`).get(),
      ).toEqual({ version: 16, name: "add-account-view-prefs" });
      expect(
        (
          upgraded.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(DB_SCHEMA_VERSION);
      upgraded.close();

      const reopened = openDb(path);
      expect(planDatabaseMigrations(reopened).migrations).toEqual([]);
      reopened.close();
    } finally {
      cleanup();
    }
  });

  it("upgrades an old-shape DB (NOT NULL projectId, missing new columns) to current", () => {
    const path = join(tmpdir(), `capacitylens-migrate-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present — fine */
        }
      }
    };
    cleanup();
    try {
      writeOldDb(path);
      // The legacy fixture also lacks required allocation foreign keys. Additive column migration
      // must not bless that drift: startup now fails closed and names the relational mismatch.
      expect(() => openDb(path)).toThrow(/foreign-key mismatch/i);
    } finally {
      cleanup();
    }
  });

  it("seeds a never-initialised DB once, and NOT after the user empties it (no demo re-seed)", () => {
    const db = openDb(":memory:");
    // Fresh DB: uninitialised → seeds.
    expect(isInitialized(db)).toBe(false);
    expect(seedIfUninitialized(db, seed())).toBe(true);
    expect(isInitialized(db)).toBe(true);
    expect(loadState(db).accounts.length).toBeGreaterThan(0);
    // Second boot of the same DB: already initialised → no re-seed.
    expect(seedIfUninitialized(db, seed())).toBe(false);

    // The user deletes ALL their data (cascade empties every scoped table; _meta survives).
    for (const a of loadState(db).accounts) deleteRow(db, "accounts", a.id);
    expect(isEmpty(loadState(db))).toBe(true);
    expect(isInitialized(db)).toBe(true); // ...but still initialised
    // The regression guard: a boot against the empty-but-initialised DB must NOT re-seed
    // (gating on isEmpty() — the old bug — would have resurrected the demo dataset here).
    expect(seedIfUninitialized(db, seed())).toBe(false);
    expect(isEmpty(loadState(db))).toBe(true);
    db.close();
  });

  it("serializes two database handles racing to seed the same fresh file", async () => {
    const path = join(tmpdir(), `capacitylens-seed-race-${process.pid}-${Date.now()}.db`);
    const parentDb = openDb(path);
    const childSource = `
      import { openDb, seedIfUninitialized } from ${JSON.stringify(new URL("./db.ts", import.meta.url).href)};
      import { seed } from "@capacitylens/shared/data/seed";
      const db = openDb(process.argv[1]);
      process.stdout.write("ready\\n");
      process.stdin.once("data", () => {
        try { process.stdout.write(String(seedIfUninitialized(db, seed())) + "\\n"); }
        finally { db.close(); }
      });
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", childSource, path], {
      cwd: new URL("..", import.meta.url),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));

    child.stdin.write("go\n");
    const parentResult = seedIfUninitialized(parentDb, seed());
    child.stdin.end();
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));

    expect(exitCode, stderr).toBe(0);
    const childResult = stdout.trim().split("\n").at(-1);
    expect([String(parentResult), childResult].sort()).toEqual(["false", "true"]);
    expect(loadState(parentDb).accounts.length).toBeGreaterThan(0);
    parentDb.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(path + suffix);
      } catch {
        // Not all SQLite sidecars are created on every platform.
      }
    }
  });

  it("generically ADDs a missing OPTIONAL column with no hard-coded migration step", () => {
    // An old `disciplines` table missing the optional `color` column. There is NO
    // hard-coded rule for disciplines.color, so this proves the migration is GENERIC —
    // a future additive optional field is picked up from the spec automatically (the old
    // version-gated pass would have frozen and left the column missing).
    const path = join(tmpdir(), `capacitylens-migrate-gen-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present — fine */
        }
      }
    };
    cleanup();
    try {
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      `);
      addLegacyCompanionTables(old);
      addLegacyDisciplineTable(old);
      old.exec(`INSERT INTO accounts VALUES ('a1','Studio','#111','${TS}','${TS}');`);
      old.close();

      const db = openDb(path); // generic pass adds disciplines.color
      expect(() =>
        insertRow(db, "disciplines", {
          id: "d1",
          accountId: "a1",
          name: "Design",
          color: "#abcdef",
          sortOrder: 0,
          createdAt: TS,
          updatedAt: TS,
        }),
      ).not.toThrow();
      expect(getRow(db, "disciplines", "d1")?.color).toBe("#abcdef");
      db.close();
    } finally {
      cleanup();
    }
  });

  it("throws a clear, column-naming error when an existing DB lacks a now-REQUIRED column", () => {
    // The flip side of the generic optional-add: an old `accounts` table that predates a
    // required column (here `color`). CREATE TABLE IF NOT EXISTS won't backfill it and
    // migrateSchema only auto-adds OPTIONAL columns — a NOT NULL addition can't be ALTER-ADDed
    // to existing rows, so it needs an explicit rebuild step that doesn't exist yet. Rather than
    // let that drift surface later as a cryptic "no column named color" on the first write (or
    // silently read back undefined), openDb's assertSchemaCurrent must fail fast and name it.
    const path = join(tmpdir(), `capacitylens-migrate-req-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present — fine */
        }
      }
    };
    cleanup();
    try {
      const old = new DatabaseSync(path);
      // accounts without the required `color` column (predates it).
      old.exec(`CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );`);
      addLegacyCompanionTables(old);
      old.close();
      expect(() => openDb(path)).toThrow(/accounts\.color/);
      // The explicit v8 step is atomic: all tables/columns it created before the assertion failed
      // rolled back with its user_version/application_id stamps, so retry/restore has one state.
      const unchanged = new DatabaseSync(path, { readOnly: true });
      expect(
        (
          unchanged.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(0);
      expect(
        (
          unchanged.prepare(`PRAGMA application_id`).get() as {
            application_id: number;
          }
        ).application_id,
      ).toBe(0);
      expect(
        (
          unchanged.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      ).toEqual(["accounts", "allocations", "clients", "projects", "resources", "tasks"]);
      unchanged.close();
    } finally {
      cleanup();
    }
  });

  it("refuses a current-version entity table with an unexpected required column", () => {
    const { path, cleanup } = mutateCurrentDatabase("migrate-extra-required", (db) => {
      db.exec("ALTER TABLE accounts ADD COLUMN blocker TEXT NOT NULL");
    });
    try {
      expect(() => openDb(path)).toThrow(/unexpected required column.*accounts\.blocker/i);
    } finally {
      cleanup();
    }
  });

  it("refuses a current control table whose composite primary key was removed", () => {
    const { path, cleanup } = mutateCurrentDatabase("control-primary-key", (db) => {
      db.exec(`
        CREATE TABLE account_members_rebuilt (
          accountId TEXT NOT NULL,
          userId TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );
        INSERT INTO account_members_rebuilt SELECT * FROM account_members;
        DROP TABLE account_members;
        ALTER TABLE account_members_rebuilt RENAME TO account_members;
        CREATE INDEX idx_account_members_userId ON account_members(userId);
        CREATE INDEX idx_account_members_accountId ON account_members(accountId);
        CREATE UNIQUE INDEX idx_account_members_single_active_owner
          ON account_members(accountId)
          WHERE role = 'owner' AND status = 'active';
      `);
    });
    try {
      expect(() => openDb(path)).toThrow(/account_members primary-key mismatch/i);
    } finally {
      cleanup();
    }
  });

  it("refuses a current control index whose name hides the wrong key definition", () => {
    const { path, cleanup } = mutateCurrentDatabase("control-index-definition", (db) => {
      db.exec(`
        DROP INDEX idx_account_members_userId;
        CREATE INDEX idx_account_members_userId ON account_members(role);
      `);
    });
    try {
      expect(() => openDb(path)).toThrow(
        /index idx_account_members_userId does not cover exactly account_members\(userId\)/i,
      );
    } finally {
      cleanup();
    }
  });

  it.each([
    {
      label: "declared type",
      mutate: (db: DatabaseSync) =>
        replaceEntityTable(db, "accounts", (sql) => sql.replace("name TEXT NOT NULL", "name BLOB NOT NULL")),
      error: /declared-type mismatch.*accounts\.name/i,
    },
    {
      label: "primary key",
      mutate: (db: DatabaseSync) =>
        replaceEntityTable(db, "accounts", (sql) => sql.replace("id TEXT NOT NULL PRIMARY KEY", "id TEXT NOT NULL")),
      error: /primary-key mismatch.*accounts\.id/i,
    },
    {
      label: "CHECK constraint",
      mutate: (db: DatabaseSync) =>
        replaceEntityTable(db, "accounts", (sql) =>
          sql.replace("name TEXT NOT NULL", "name TEXT NOT NULL CHECK (name <> 'blocked')"),
        ),
      error: /unexpected write constraint.*accounts has an unexpected CHECK/i,
    },
    {
      label: "STRICT option",
      mutate: (db: DatabaseSync) => replaceEntityTable(db, "accounts", (sql) => `${sql} STRICT`),
      error: /unexpected write constraint.*accounts has unsupported table options/i,
    },
    {
      label: "UNIQUE index",
      mutate: (db: DatabaseSync) => db.exec("CREATE UNIQUE INDEX accounts_name_unique ON accounts(name)"),
      error: /unexpected write constraint.*accounts\.accounts_name_unique.*UNIQUE/i,
    },
    {
      label: "write trigger",
      mutate: (db: DatabaseSync) =>
        db.exec(`
        CREATE TRIGGER accounts_reject_insert BEFORE INSERT ON accounts
        BEGIN SELECT RAISE(ABORT, 'blocked'); END
      `),
      error: /unexpected write constraint.*accounts\.accounts_reject_insert.*trigger/i,
    },
  ])("refuses current-version $label drift before accepting writes", ({ label, mutate, error }) => {
    const { path, cleanup } = mutateCurrentDatabase(`migrate-${label.replaceAll(" ", "-")}`, mutate);
    try {
      expect(() => openDb(path)).toThrow(error);
    } finally {
      cleanup();
    }
  });

  it("allows extension columns that the explicit insert contract can safely omit", () => {
    const { path, cleanup } = mutateCurrentDatabase("migrate-benign-extensions", (db) => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN extensionNote TEXT;
        ALTER TABLE accounts ADD COLUMN extensionSource TEXT NOT NULL DEFAULT 'legacy';
      `);
    });
    try {
      const db = openDb(path);
      expect(() =>
        insertRow(db, "accounts", {
          id: "a-extension",
          name: "Extension-safe",
          color: "#3b82f6",
          createdAt: TS,
          updatedAt: TS,
        }),
      ).not.toThrow();
      expect(getRow(db, "accounts", "a-extension")).toMatchObject({
        id: "a-extension",
        name: "Extension-safe",
      });
      db.close();
    } finally {
      cleanup();
    }
  });

  it("accounts.timezone and accounts.weekStartsOn are added by migration", () => {
    // An old accounts table without the new optional columns.
    const path = join(tmpdir(), `capacitylens-migrate-tz-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* fine */
        }
      }
    };
    cleanup();
    try {
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE accounts (
          id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
          schedulingMode TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
      `);
      addLegacyCompanionTables(old);
      old.exec(`INSERT INTO accounts VALUES ('a1','Studio','#111',NULL,'${TS}','${TS}');`);
      old.close();

      const db = openDb(path);
      // After migration, both new optional columns exist and round-trip.
      insertRow(db, "accounts", {
        id: "a2",
        name: "New Studio",
        color: "#222",
        timezone: "Europe/Paris",
        weekStartsOn: 0,
        createdAt: TS,
        updatedAt: TS,
      });
      const row = getRow(db, "accounts", "a2");
      expect(row?.timezone).toBe("Europe/Paris");
      expect(row?.weekStartsOn).toBe(0);
      // The old row (without the new fields) reads back without them.
      const old2 = getRow(db, "accounts", "a1");
      expect(old2?.timezone).toBeUndefined();
      expect(old2?.weekStartsOn).toBeUndefined();
      db.close();
    } finally {
      cleanup();
    }
  });

  it("accounts.placeholdersEnabled and accounts.externalEnabled are added by migration", () => {
    // An old accounts table without the two new optional view-pref columns.
    const path = join(tmpdir(), `capacitylens-migrate-flags-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* fine */
        }
      }
    };
    cleanup();
    try {
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE accounts (
          id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
          schedulingMode TEXT, timezone TEXT, weekStartsOn TEXT, disciplinesEnabled TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
      `);
      addLegacyCompanionTables(old);
      old.exec(
        `INSERT INTO accounts (id,name,color,createdAt,updatedAt) VALUES ('a1','Studio','#111','${TS}','${TS}');`,
      );
      old.close();

      const db = openDb(path);
      // After migration, both new optional columns exist and round-trip a present boolean. The v9/v16
      // additive columns (internalColourMode + the three schedule view prefs) also come in via the
      // migration chain and round-trip.
      insertRow(db, "accounts", {
        id: "a2",
        name: "New Studio",
        color: "#222",
        placeholdersEnabled: true,
        externalEnabled: true,
        showInternalProjects: false,
        showInternalActivities: false,
        inlineActivityCreateEnabled: false,
        createdAt: TS,
        updatedAt: TS,
      });
      const row = getRow(db, "accounts", "a2");
      expect(row?.placeholdersEnabled).toBe(true);
      expect(row?.externalEnabled).toBe(true);
      // JSON boolean columns round-trip an explicit `false` (not lost / not coerced to absent).
      expect(row?.showInternalProjects).toBe(false);
      expect(row?.showInternalActivities).toBe(false);
      expect(row?.inlineActivityCreateEnabled).toBe(false);
      // The old row (without the new fields) reads back without them (absent → default true client-side
      // for the view prefs, false for placeholders/external).
      const old2 = getRow(db, "accounts", "a1");
      expect(old2?.placeholdersEnabled).toBeUndefined();
      expect(old2?.externalEnabled).toBeUndefined();
      expect(old2?.showInternalProjects).toBeUndefined();
      expect(old2?.showInternalActivities).toBeUndefined();
      expect(old2?.inlineActivityCreateEnabled).toBeUndefined();
      db.close();
    } finally {
      cleanup();
    }
  });

  it("throws a nullability-mismatch error when a column is present but NULL/NOT NULL disagrees with the spec", () => {
    // accounts.schedulingMode is OPTIONAL in the spec (nullable), but here the on-disk column
    // exists as NOT NULL. It's present, so migrateSchema won't touch it and the missing-column
    // check passes — only the nullability check catches that the two sources of truth (TABLES'
    // optional? flag vs SCHEMA_SQL's NOT NULL) have drifted. Without it, a write that legitimately
    // omits schedulingMode would hit a confusing NOT NULL error instead.
    const path = join(tmpdir(), `capacitylens-migrate-null-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present — fine */
        }
      }
    };
    cleanup();
    try {
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
        schedulingMode TEXT NOT NULL,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );`);
      addLegacyCompanionTables(old);
      old.close();
      expect(() => openDb(path)).toThrow(/schedulingMode/);
      expect(() => openDb(path)).toThrow(/nullability/i);
    } finally {
      cleanup();
    }
  });

  it("stamps a fresh DB with the independent physical version and CapacityLens application id", () => {
    const db = openDb(":memory:");
    expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(DB_SCHEMA_VERSION);
    expect((db.prepare(`PRAGMA application_id`).get() as { application_id: number }).application_id).toBe(
      CAPACITYLENS_APPLICATION_ID,
    );
    const history = db
      .prepare(`SELECT version, name, checksum, appliedAt FROM ${DATABASE_MIGRATION_TABLE} ORDER BY version`)
      .all() as Array<{
      version: number;
      name: string;
      checksum: string;
      appliedAt: string;
    }>;
    // Every shipped definition is immutable. Pin the complete ledger in one table so adding a
    // migration or editing any released definition requires an explicit review of this contract.
    expect(
      history.map(({ version, name, checksum }) => ({
        version,
        name,
        checksum,
      })),
    ).toEqual([
      {
        version: 8,
        name: "establish-explicit-migration-baseline",
        checksum: "90add4af35f1914f7de3ca031528ad81e061424526b50ae099512aacf650ef3d",
      },
      {
        version: 9,
        name: "add-internal-colour-mode",
        checksum: "41f8f933f17eb59dac8bfc7a385db70e46df61e249a295fd622f821dcc3bb1f0",
      },
      {
        version: 10,
        name: "enforce-single-owner",
        checksum: "a178fba43ad4c58ca8508117303b568c05103a05cc6e48512f2e92306e857653",
      },
      {
        version: 11,
        name: "repair-ownerless-memberships",
        checksum: "561d0b306d9702e807d45702ec2424f0421b44eb2bc34adab7abc8ba08875117",
      },
      {
        version: 12,
        name: "revoke-owner-reset-ceremonies",
        checksum: "4e7a506b4324de4e8d48ad843d1eabe70b4723c6e9bb4e44f2ed1c76046b2b56",
      },
      {
        version: 13,
        name: "snap-legacy-account-colors",
        checksum: "1067b03a5483de517efc575e5597c633e8f6a6640bec02c5f0087e76b53ce7d1",
      },
      {
        version: 14,
        name: "revoke-member-reset-ceremonies",
        checksum: "a99f4cb99587c3cfeef7cc3fe618a4223160ba3c01b2ec391a64251ae17556e1",
      },
      {
        version: 15,
        name: "add-account-boundary-state",
        checksum: "3aaf6516f6ccd9d0f107d2d972d94219709e907d1cdc0fdf65c218d8e38b0efb",
      },
      {
        version: 16,
        name: "add-account-view-prefs",
        checksum: "7c6209e72a7a3a100a8d1b513420341f9ddbe73c562810ce01c277f0480c99a1",
      },
      {
        version: 17,
        name: "add-durable-audit-outbox",
        checksum: "f2a4dba4fb74de14aa40f57b42c214593a824ffdee2617972fc44d65f8e9f372",
      },
      {
        version: 18,
        name: "add-browser-sync-ordering",
        checksum: "9f36a8cc44912588daa937c7144386d45c44f9d165aa4df2bb08b69b279aa49a",
      },
      {
        version: 19,
        name: "enforce-tenant-relationship-integrity",
        checksum: "558cc0192ffdae7ef6aa47e189a10ef6e371154fedb74242ff692bb9e52ed74c",
      },
      {
        version: 20,
        name: "version-bootstrap-claim-control",
        checksum: "3723fb194afa8f85d3fe9a93493197f3e59eabbb030a8286ac1e030c661077b0",
      },
      {
        version: 21,
        name: "index-tenant-entity-slices",
        checksum: "431d2dc119c652583f26e0bc47f39a80957ca24c82ac6519cec9e8e846db7441",
      },
      {
        version: 22,
        name: "reactivate-builtin-internal-clients",
        checksum: "05283dd0a42049e3a20cb75a7a0a3063670e003aace3a3c7d3a3ed6d35698560",
      },
      {
        version: 23,
        name: "index-foreign-key-children",
        checksum: "b9cd82f6191f8e3ba675a77f09cbf5cc8cbc05b130e486d9dd1681ea0403e6ef",
      },
      {
        version: 24,
        name: "bound-used-invitation-history",
        checksum: "a8bdf450c3741579a8a83598f9fe1941358332e6fe00044cf82c5e4ae66d3e24",
      },
    ]);
    expect(history.every((row) => !Number.isNaN(Date.parse(row.appliedAt)))).toBe(true);
    expect(planDatabaseMigrations(db).migrations).toEqual([]);
    db.close();
  });

  it("treats migrations committed by a concurrent boot after planning as already applied", () => {
    const copied = copyFixture("v16-off.db");
    try {
      const losingHandle = openDbConnection(copied.path);
      let winnerRan = false;
      const plannedBeforeWinner = planDatabaseMigrations(losingHandle).migrations.map(({ version }) => version);
      const losingBoot = new Proxy(losingHandle, {
        get(target, property) {
          if (property === "exec") {
            return (sql: string) => {
              if (!winnerRan && sql.trim() === "BEGIN IMMEDIATE") {
                winnerRan = true;
                const winner = openDbConnection(copied.path);
                initializeOpenDb(winner, copied.path);
                winner.close();
              }
              return target.exec(sql);
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as Db;

      expect(plannedBeforeWinner).toEqual([17, 18, 19, 20, 21, 22, 23, 24]);
      expect(() => initializeOpenDb(losingBoot, copied.path)).not.toThrow();
      expect(winnerRan).toBe(true);
      expect(
        (
          losingHandle.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(DB_SCHEMA_VERSION);
      expect(planDatabaseMigrations(losingHandle).migrations).toEqual([]);
      losingHandle.close();
    } finally {
      copied.cleanup();
    }
  });

  it("v17 adds the durable audit outbox through one explicit ledger step", () => {
    const db = openDb(":memory:");
    db.exec(`
      DROP TABLE capacitylens_sync_row_provenance;
      DROP TABLE capacitylens_sync_sessions;
      DROP TABLE capacitylens_audit_outbox;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 17;
      PRAGMA user_version = 16;
    `);

    const plan = planDatabaseMigrations(db).migrations;
    expect(plan.map((migration) => migration.version)).toEqual([17, 18, 19, 20, 21, 22, 23, 24]);
    expect(plan[0]).toEqual({
      version: 17,
      name: "add-durable-audit-outbox",
      checksum: "f2a4dba4fb74de14aa40f57b42c214593a824ffdee2617972fc44d65f8e9f372",
    });

    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`PRAGMA table_info(capacitylens_audit_outbox)`).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sequence", type: "INTEGER", pk: 1 }),
        expect.objectContaining({ name: "id", type: "TEXT", notnull: 1 }),
        expect.objectContaining({ name: "payload", type: "TEXT", notnull: 1 }),
        expect.objectContaining({
          name: "createdAt",
          type: "TEXT",
          notnull: 1,
        }),
      ]),
    );
    db.close();
  });

  it("v18 adds durable browser-sync ordering through one explicit ledger step", () => {
    const db = openDb(":memory:");
    db.exec(`
      DROP TABLE capacitylens_sync_row_provenance;
      DROP TABLE capacitylens_sync_sessions;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 18;
      PRAGMA user_version = 17;
    `);

    expect(planDatabaseMigrations(db).migrations[0]).toEqual({
      version: 18,
      name: "add-browser-sync-ordering",
      checksum: "9f36a8cc44912588daa937c7144386d45c44f9d165aa4df2bb08b69b279aa49a",
    });

    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`PRAGMA table_info(capacitylens_sync_sessions)`).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sessionId", type: "TEXT", pk: 1 }),
        expect.objectContaining({
          name: "lastSequence",
          type: "INTEGER",
          notnull: 1,
        }),
      ]),
    );
    expect(db.prepare(`PRAGMA table_info(capacitylens_sync_row_provenance)`).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tableName", type: "TEXT", pk: 1 }),
        expect.objectContaining({ name: "rowId", type: "TEXT", pk: 2 }),
        expect.objectContaining({
          name: "accountId",
          type: "TEXT",
          notnull: 1,
        }),
        expect.objectContaining({ name: "rowHash", type: "TEXT", notnull: 1 }),
      ]),
    );
    db.close();
  });

  it("v19 rejects an existing cross-account edge and rolls back its triggers and ledger step", () => {
    const db = openDb(":memory:");
    const triggers = db
      .prepare(
        `
      SELECT name FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE 'capacitylens_tenant_%'
    `,
      )
      .all() as Array<{ name: string }>;
    for (const { name } of triggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec(`
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 19;
      PRAGMA user_version = 18;
      INSERT INTO accounts (id, name, color, createdAt, updatedAt)
        VALUES ('a1', 'One', '#3b82f6', '${TS}', '${TS}'),
               ('a2', 'Two', '#3b82f6', '${TS}', '${TS}');
      INSERT INTO resources (
        id, accountId, kind, name, role, employmentType, workingHoursPerDay,
        workingDays, color, createdAt, updatedAt
      ) VALUES (
        'r2', 'a2', 'person', 'Resource Two', 'Designer', 'employee', 8,
        '[1,2,3,4,5]', '#3b82f6', '${TS}', '${TS}'
      );
      INSERT INTO activities (id, accountId, name, kind, createdAt, updatedAt)
        VALUES ('act1', 'a1', 'Activity One', 'repeatable', '${TS}', '${TS}');
      INSERT INTO allocations (
        id, accountId, resourceId, activityId, startDate, endDate, hoursPerDay,
        status, createdAt, updatedAt
      ) VALUES (
        'al1', 'a1', 'r2', 'act1', '2026-01-01', '2026-01-02', 4,
        'tentative', '${TS}', '${TS}'
      );
    `);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    expect(() => initializeOpenDb(db, ":memory:")).toThrow(
      /allocations\.resourceId -> resources\.id has parent account "a2" and child account "a1"/,
    );
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(18);
    expect(db.prepare(`SELECT 1 FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 19`).get()).toBeUndefined();
    expect(
      db
        .prepare(
          `
      SELECT name FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE 'capacitylens_tenant_%'
    `,
        )
        .all(),
    ).toEqual([]);
    db.close();
  });

  it("v20 creates the bootstrap-claim control through one explicit ledger step", () => {
    const db = openDb(":memory:");
    dropTenantEntityIndexes(db);
    db.exec(`
      DROP TABLE capacitylens_bootstrap_claim;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 20;
      PRAGMA user_version = 19;
    `);

    expect(planDatabaseMigrations(db).migrations).toEqual([
      {
        version: 20,
        name: "version-bootstrap-claim-control",
        checksum: "3723fb194afa8f85d3fe9a93493197f3e59eabbb030a8286ac1e030c661077b0",
      },
      {
        version: 21,
        name: "index-tenant-entity-slices",
        checksum: "431d2dc119c652583f26e0bc47f39a80957ca24c82ac6519cec9e8e846db7441",
      },
      {
        version: 22,
        name: "reactivate-builtin-internal-clients",
        checksum: "05283dd0a42049e3a20cb75a7a0a3063670e003aace3a3c7d3a3ed6d35698560",
      },
      {
        version: 23,
        name: "index-foreign-key-children",
        checksum: "b9cd82f6191f8e3ba675a77f09cbf5cc8cbc05b130e486d9dd1681ea0403e6ef",
      },
      {
        version: 24,
        name: "bound-used-invitation-history",
        checksum: "a8bdf450c3741579a8a83598f9fe1941358332e6fe00044cf82c5e4ae66d3e24",
      },
    ]);

    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all()).toEqual([
      expect.objectContaining({
        name: "id",
        type: "INTEGER",
        notnull: 0,
        pk: 1,
      }),
      expect.objectContaining({
        name: "claimedAt",
        type: "TEXT",
        notnull: 1,
        pk: 0,
      }),
      expect.objectContaining({
        name: "claimToken",
        type: "TEXT",
        notnull: 1,
        pk: 0,
      }),
    ]);
    expect(() => db.prepare(`INSERT INTO capacitylens_bootstrap_claim VALUES (2, ?, ?)`).run(TS, "token")).toThrow(
      /check constraint/i,
    );
    expect(() => db.prepare(`INSERT INTO capacitylens_bootstrap_claim VALUES (1, ?, NULL)`).run(TS)).toThrow(
      /not null constraint/i,
    );
    db.close();
  });

  it.each([
    {
      label: "original two-column definition",
      ddl: `CREATE TABLE capacitylens_bootstrap_claim (
        id INTEGER PRIMARY KEY CHECK (id = 1), claimedAt TEXT NOT NULL
      )`,
      insert: `INSERT INTO capacitylens_bootstrap_claim (id, claimedAt) VALUES (1, '${TS}')`,
    },
    {
      label: "nullable-token ALTER result",
      ddl: `CREATE TABLE capacitylens_bootstrap_claim (
        id INTEGER PRIMARY KEY CHECK (id = 1), claimedAt TEXT NOT NULL, claimToken TEXT
      )`,
      insert: `INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, '${TS}', NULL)`,
    },
  ])("v20 repairs the known $label and clears its unauthenticated lease", ({ ddl, insert }) => {
    const db = openDb(":memory:");
    dropTenantEntityIndexes(db);
    db.exec(`
      DROP TABLE capacitylens_bootstrap_claim;
      ${ddl};
      ${insert};
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 20;
      PRAGMA user_version = 19;
    `);

    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`SELECT * FROM capacitylens_bootstrap_claim`).all()).toEqual([]);
    expect(db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "claimToken",
          type: "TEXT",
          notnull: 1,
        }),
      ]),
    );
    db.close();
  });

  it("v20 preserves a live claim when the direct-DDL table is already exact", () => {
    const db = openDb(":memory:");
    db.prepare(`INSERT INTO capacitylens_bootstrap_claim (id, claimedAt, claimToken) VALUES (1, ?, ?)`).run(
      TS,
      "live-token",
    );
    dropTenantEntityIndexes(db);
    db.exec(`
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 20;
      PRAGMA user_version = 19;
    `);

    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`SELECT id, claimedAt, claimToken FROM capacitylens_bootstrap_claim`).get()).toEqual({
      id: 1,
      claimedAt: TS,
      claimToken: "live-token",
    });
    db.close();
  });

  it("v20 rejects unknown bootstrap-claim drift and rolls its ledger step back", () => {
    const db = openDb(":memory:");
    dropTenantEntityIndexes(db);
    db.exec(`
      DROP TABLE capacitylens_bootstrap_claim;
      CREATE TABLE capacitylens_bootstrap_claim (
        id INTEGER PRIMARY KEY CHECK (id = 1), claimToken TEXT NOT NULL
      );
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 20;
      PRAGMA user_version = 19;
    `);

    expect(planDatabaseMigrations(db).migrations.map((migration) => migration.version)).toEqual([20, 21, 22, 23, 24]);
    expect(() => initializeOpenDb(db, ":memory:")).toThrow(/unknown schema.*unsafe automatic repair/i);
    expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(19);
    expect(db.prepare(`SELECT 1 FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 20`).get()).toBeUndefined();
    expect(
      (db.prepare(`PRAGMA table_info(capacitylens_bootstrap_claim)`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    ).toEqual(["id", "claimToken"]);
    db.close();
  });

  it("v21 adds every tenant-slice index through one explicit ledger step", () => {
    const db = openDb(":memory:");
    dropTenantEntityIndexes(db);
    db.exec(`
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 21;
      PRAGMA user_version = 20;
    `);

    expect(planDatabaseMigrations(db).migrations).toEqual([
      {
        version: 21,
        name: "index-tenant-entity-slices",
        checksum: "431d2dc119c652583f26e0bc47f39a80957ca24c82ac6519cec9e8e846db7441",
      },
      {
        version: 22,
        name: "reactivate-builtin-internal-clients",
        checksum: "05283dd0a42049e3a20cb75a7a0a3063670e003aace3a3c7d3a3ed6d35698560",
      },
      {
        version: 23,
        name: "index-foreign-key-children",
        checksum: "b9cd82f6191f8e3ba675a77f09cbf5cc8cbc05b130e486d9dd1681ea0403e6ef",
      },
      {
        version: 24,
        name: "bound-used-invitation-history",
        checksum: "a8bdf450c3741579a8a83598f9fe1941358332e6fe00044cf82c5e4ae66d3e24",
      },
    ]);

    initializeOpenDb(db, ":memory:");
    expect(() => assertTenantEntityIndexesCurrent(db)).not.toThrow();
    const installed = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>
    ).map(({ name }) => name);
    expect(installed).toEqual(expect.arrayContaining(TENANT_ENTITY_ACCOUNT_INDEXES_V21.map(({ index }) => index)));
    expect(TENANT_ENTITY_INDEXES_V21_SQL).toContain("idx_allocations_accountId");
    db.close();
  });

  it("v22 reactivates tombstoned built-in Internal clients and advances their revisions", () => {
    const db = openDb(":memory:");
    insertRow(db, "accounts", {
      id: "a-archived",
      name: "Archived Studio",
      color: "#e02727",
      createdAt: TS,
      updatedAt: TS,
    });
    insertRow(db, "accounts", {
      id: "a-deleted",
      name: "Deleted Studio",
      color: "#e02727",
      createdAt: TS,
      updatedAt: TS,
    });
    insertRow(db, "clients", buildInternalClient("a-archived", TS) as unknown as Record<string, unknown>);
    insertRow(db, "clients", buildInternalClient("a-deleted", TS) as unknown as Record<string, unknown>);
    const priorRevision = "2099-01-01T00:00:00.000Z";
    db.prepare(`UPDATE clients SET archivedAt = ?, updatedAt = ? WHERE id = ?`).run(
      TS,
      priorRevision,
      "internal:a-archived",
    );
    db.prepare(`UPDATE clients SET archivedAt = ?, deletedAt = ?, updatedAt = ? WHERE id = ?`).run(
      TS,
      "2026-01-02T00:00:00.000Z",
      priorRevision,
      "internal:a-deleted",
    );
    db.exec(`
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 22;
      PRAGMA user_version = 21;
    `);

    expect(planDatabaseMigrations(db).migrations).toEqual([
      {
        version: 22,
        name: "reactivate-builtin-internal-clients",
        checksum: "05283dd0a42049e3a20cb75a7a0a3063670e003aace3a3c7d3a3ed6d35698560",
      },
      {
        version: 23,
        name: "index-foreign-key-children",
        checksum: "b9cd82f6191f8e3ba675a77f09cbf5cc8cbc05b130e486d9dd1681ea0403e6ef",
      },
      {
        version: 24,
        name: "bound-used-invitation-history",
        checksum: "a8bdf450c3741579a8a83598f9fe1941358332e6fe00044cf82c5e4ae66d3e24",
      },
    ]);

    initializeOpenDb(db, ":memory:");
    for (const id of ["internal:a-archived", "internal:a-deleted"]) {
      const repaired = getRow(db, "clients", id);
      expect(repaired?.builtin).toBe(true);
      expect(repaired).not.toHaveProperty("archivedAt");
      expect(repaired).not.toHaveProperty("deletedAt");
      expect(Date.parse(repaired?.updatedAt as string)).toBeGreaterThan(Date.parse(priorRevision));
    }
    expect(db.prepare(`SELECT version, name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 22`).get()).toEqual({
      version: 22,
      name: "reactivate-builtin-internal-clients",
    });

    const revisions = db.prepare(`SELECT id, updatedAt FROM clients ORDER BY id`).all();
    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`SELECT id, updatedAt FROM clients ORDER BY id`).all()).toEqual(revisions);
    db.close();
  });

  it("v23 adds every foreign-key child index through one explicit ledger step", () => {
    const db = openDb(":memory:");
    for (const { index } of FOREIGN_KEY_CHILD_INDEXES_V23) db.exec(`DROP INDEX ${index}`);
    db.exec(`
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 23;
      PRAGMA user_version = 22;
    `);

    expect(planDatabaseMigrations(db).migrations).toEqual([
      {
        version: 23,
        name: "index-foreign-key-children",
        checksum: "b9cd82f6191f8e3ba675a77f09cbf5cc8cbc05b130e486d9dd1681ea0403e6ef",
      },
      {
        version: 24,
        name: "bound-used-invitation-history",
        checksum: "a8bdf450c3741579a8a83598f9fe1941358332e6fe00044cf82c5e4ae66d3e24",
      },
    ]);

    initializeOpenDb(db, ":memory:");
    expect(() => assertTenantEntityIndexesCurrent(db)).not.toThrow();
    const installed = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    );
    for (const { index } of FOREIGN_KEY_CHILD_INDEXES_V23) expect(installed.has(index)).toBe(true);
    db.close();
  });

  it("v24 bounds pre-existing used invitation history and installs its lookup indexes", () => {
    const db = openDb(":memory:");
    db.exec(`
      DROP INDEX idx_invites_account_usedAt_id;
      DROP INDEX idx_invites_live_preauthEmail;
      DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 24;
      PRAGMA user_version = 23;
    `);
    const insert = (accountId: string, id: string, usedAt: string | null, expiresAt = "2999-01-01T00:00:00.000Z") =>
      createInvite(db, {
        token: `token-${accountId}-${id}`,
        id,
        accountId,
        role: "viewer",
        preauthEmail: usedAt === null ? "live@example.com" : null,
        expiresAt,
        usedAt,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    for (let index = 0; index < USED_INVITATION_RETENTION_LIMIT + 2; index += 1) {
      insert("account-1", `recent-${String(index).padStart(3, "0")}`, "2998-01-01T00:00:00.000Z");
    }
    insert("account-1", "old", "2000-01-01T00:00:00.000Z");
    insert("account-1", "live", null);
    insert("account-1", "expired-unused", null, "2000-01-01T00:00:00.000Z");
    insert("account-2", "other-account", "2998-01-01T00:00:00.000Z");

    expect(planDatabaseMigrations(db).migrations).toEqual([
      {
        version: 24,
        name: "bound-used-invitation-history",
        checksum: "a8bdf450c3741579a8a83598f9fe1941358332e6fe00044cf82c5e4ae66d3e24",
      },
    ]);
    initializeOpenDb(db, ":memory:");

    expect(listInvitesForAccount(db, "account-1")).toHaveLength(USED_INVITATION_RETENTION_LIMIT + 2);
    expect(listInvitesForAccount(db, "account-1").map(({ id }) => id)).toEqual(
      expect.arrayContaining(["live", "expired-unused"]),
    );
    expect(listInvitesForAccount(db, "account-2").map(({ id }) => id)).toEqual(["other-account"]);
    const indexes = new Set(
      (db.prepare(`PRAGMA index_list(invites)`).all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect(indexes.has("idx_invites_account_usedAt_id")).toBe(true);
    expect(indexes.has("idx_invites_live_preauthEmail")).toBe(true);

    const rows = db.prepare(`SELECT id FROM invites ORDER BY id`).all();
    initializeOpenDb(db, ":memory:");
    expect(db.prepare(`SELECT id FROM invites ORDER BY id`).all()).toEqual(rows);
    db.close();
  });

  it("refuses missing or checksummed migration-history drift before planning writes", () => {
    const db = openDb(":memory:");
    db.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = ?`).run(
      "0".repeat(64),
      DB_SCHEMA_VERSION,
    );
    expect(() => planDatabaseMigrations(db)).toThrow(/checksum does not match/i);

    db.prepare(`DELETE FROM ${DATABASE_MIGRATION_TABLE}`).run();
    expect(() => planDatabaseMigrations(db)).toThrow(/history has 0 row/i);
    db.close();
  });

  it("rolls back schema, history and version stamps when a migration fails before commit", () => {
    const copied = copyFixture("v7-off.db");
    try {
      const db = openDbConnection(copied.path);
      const injected = Object.assign(new Error("simulated disk exhaustion"), {
        code: "ENOSPC",
      });
      expect(() =>
        initializeOpenDb(db, copied.path, {
          beforeCommit: () => {
            throw injected;
          },
        }),
      ).toThrow(/simulated disk exhaustion/i);
      expect((db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(7);
      expect(
        (
          db.prepare(`PRAGMA application_id`).get() as {
            application_id: number;
          }
        ).application_id,
      ).toBe(0);
      expect(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(DATABASE_MIGRATION_TABLE),
      ).toBeUndefined();
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as {
            n: number;
          }
        ).n,
      ).toBe(2);
      db.close();
    } finally {
      copied.cleanup();
    }
  });

  it("emits v11 owner-promotion outcomes only after the migration commits", () => {
    const copied = copyFixture("v9-off.db");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const db = openDbConnection(copied.path);
      db.prepare(`UPDATE account_members SET role = 'admin' WHERE accountId = ?`).run("a-studio");

      expect(() =>
        initializeOpenDb(db, copied.path, {
          beforeCommit: (migration) => {
            if (migration.version === 11) throw new Error("stop before v11 commit");
          },
        }),
      ).toThrow(/stop before v11 commit/i);
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(10);
      expect(db.prepare(`SELECT role FROM account_members WHERE accountId = ?`).get("a-studio")).toEqual({
        role: "admin",
      });
      expect(warn).not.toHaveBeenCalled();

      initializeOpenDb(db, copied.path);
      expect(db.prepare(`SELECT role FROM account_members WHERE accountId = ?`).get("a-studio")).toEqual({
        role: "owner",
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain("ownerless-owner-promotion");
      db.close();
    } finally {
      warn.mockRestore();
      copied.cleanup();
    }
  });

  it("upgrades a committed v8 database through the current version without changing the v8 ledger row", () => {
    const copied = copyFixture("v7-off.db");
    try {
      const db = openDbConnection(copied.path);
      expect(() =>
        initializeOpenDb(db, copied.path, {
          beforeCommit: (migration) => {
            if (migration.version === 9) throw new Error("stop before v9 commit");
          },
        }),
      ).toThrow(/stop before v9 commit/i);
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(8);
      expect(db.prepare(`SELECT checksum FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 8`).get()).toEqual({
        checksum: "90add4af35f1914f7de3ca031528ad81e061424526b50ae099512aacf650ef3d",
      });
      expect(
        (
          db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      ).not.toContain("internalColourMode");
      expect(
        (
          db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      ).not.toEqual(
        expect.arrayContaining(["showInternalProjects", "showInternalActivities", "inlineActivityCreateEnabled"]),
      );
      db.close();

      const upgraded = openDb(copied.path);
      expect(
        (
          upgraded.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(DB_SCHEMA_VERSION);
      expect(
        (
          upgraded.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      ).toContain("internalColourMode");
      expect(
        (upgraded.prepare(`PRAGMA index_list(account_members)`).all() as Array<{ name: string }>).map(
          (index) => index.name,
        ),
      ).toContain("idx_account_members_single_active_owner");
      upgraded.close();
    } finally {
      copied.cleanup();
    }
  });

  it("keeps the v8 migration independent from later additions to the live table model", () => {
    const copied = copyFixture("v7-off.db");
    const originalAccounts = TABLES.accounts;
    let db: Db | undefined;
    try {
      TABLES.accounts = {
        ...originalAccounts,
        columns: [...originalAccounts.columns, { name: "futureOptional", optional: true }],
      };
      db = openDbConnection(copied.path);
      expect(() =>
        initializeOpenDb(db!, copied.path, {
          beforeCommit: (migration) => {
            if (migration.version === 9) throw new Error("stop before v9 commit");
          },
        }),
      ).toThrow(/stop before v9 commit/i);

      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(8);
      const accountColumns = (
        db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{
          name: string;
        }>
      ).map((column) => column.name);
      expect(accountColumns).not.toContain("futureOptional");
    } finally {
      TABLES.accounts = originalAccounts;
      db?.close();
      copied.cleanup();
    }
  });

  it("keeps migration v16 independent from a future required live-model column", () => {
    const copied = copyFixture("v15-off.db");
    const originalPhases = TABLES.phases;
    let db: Db | undefined;
    try {
      TABLES.phases = {
        ...originalPhases,
        columns: [...originalPhases.columns, { name: "futureRequired" }],
      };
      db = openDbConnection(copied.path);
      expect(() =>
        initializeOpenDb(db!, copied.path, {
          beforeCommit: (migration) => {
            if (migration.version === 17) throw new Error("stop after committed v16");
          },
        }),
      ).toThrow(/stop after committed v16/i);

      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(16);
      expect(
        (
          db.prepare(`PRAGMA table_info(phases)`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      ).not.toContain("futureRequired");
    } finally {
      TABLES.phases = originalPhases;
      db?.close();
      copied.cleanup();
    }
  });

  it("refuses a future database without mutating its version", () => {
    const path = join(tmpdir(), `capacitylens-future-${process.pid}-${Date.now()}.db`);
    try {
      const future = new DatabaseSync(path);
      future.exec(`PRAGMA user_version = ${DB_SCHEMA_VERSION + 1}`);
      future.close();
      expect(() => openDb(path)).toThrow(/newer than this server supports/i);
      const unchanged = new DatabaseSync(path, { readOnly: true });
      expect(
        (
          unchanged.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(DB_SCHEMA_VERSION + 1);
      unchanged.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    }
  });

  it("refuses a SQLite file claimed by another application", () => {
    const path = join(tmpdir(), `capacitylens-wrong-app-${process.pid}-${Date.now()}.db`);
    try {
      const other = new DatabaseSync(path);
      other.exec(`CREATE TABLE accounts (id TEXT); PRAGMA application_id = 1234`);
      other.close();
      chmodSync(path, 0o666);
      expect(() => openDb(path)).toThrow(/does not identify a CapacityLens database/i);
      expect(statSync(path).mode & 0o777).toBe(0o666);
      const unchanged = new DatabaseSync(path, { readOnly: true });
      expect(
        (unchanged.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n,
      ).toBe(1);
      unchanged.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    }
  });

  it("refuses an unclaimed SQLite file with only generic accounts and disciplines tables", () => {
    const path = join(tmpdir(), `capacitylens-ambiguous-${process.pid}-${Date.now()}.db`);
    try {
      const other = new DatabaseSync(path);
      other.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE TABLE disciplines (
          id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name TEXT NOT NULL, sortOrder INTEGER NOT NULL,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        INSERT INTO accounts VALUES ('unrelated', 'Unrelated', '#111111', '${TS}', '${TS}');
      `);
      other.close();
      expect(() => openDb(path)).toThrow(/no CapacityLens application_id or legacy CapacityLens shape/i);
      const unchanged = new DatabaseSync(path, { readOnly: true });
      expect(
        (unchanged.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n,
      ).toBe(2);
      expect(unchanged.prepare(`SELECT id FROM accounts`).all()).toEqual([{ id: "unrelated" }]);
      expect(
        (
          unchanged.prepare(`PRAGMA user_version`).get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(0);
      expect(
        (
          unchanged.prepare(`PRAGMA application_id`).get() as {
            application_id: number;
          }
        ).application_id,
      ).toBe(0);
      unchanged.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    }
  });

  it.each(RELEASED_FIXTURE_VERSIONS)(
    "upgrades the released v%s auth-off fixture, preserves data, and is idempotent on reopen",
    (version) => {
      const copied = copyFixture(`v${version}-off.db`);
      try {
        const released = new DatabaseSync(copied.path, { readOnly: true });
        expect(
          (
            released.prepare(`PRAGMA user_version`).get() as {
              user_version: number;
            }
          ).user_version,
        ).toBe(version);
        const originalAccounts = released.prepare(`SELECT id, name FROM accounts ORDER BY id`).all();
        const originalValues = captureMigrationValues(released);
        released.close();

        const db = openDb(copied.path);
        expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(
          DB_SCHEMA_VERSION,
        );
        expect(db.prepare(`SELECT id, name FROM accounts ORDER BY id`).all()).toEqual(originalAccounts);
        assertMigrationValuesPreserved(originalValues, captureMigrationValues(db), version);
        expect(
          (
            db.prepare(`SELECT COUNT(*) AS n FROM account_members`).get() as {
              n: number;
            }
          ).n,
        ).toBe(1);
        expect(
          (
            db.prepare(`SELECT COUNT(*) AS n FROM invites`).get() as {
              n: number;
            }
          ).n,
        ).toBe(1);
        expect((db.prepare(`PRAGMA quick_check`).get() as { quick_check: string }).quick_check).toBe("ok");
        expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
        const fresh = openDb(":memory:");
        expect(schemaFingerprint(db)).toEqual(schemaFingerprint(fresh));
        fresh.close();
        db.close();

        const reopened = openDb(copied.path);
        expect(planDatabaseMigrations(reopened).migrations).toEqual([]);
        expect(reopened.prepare(`PRAGMA foreign_key_check`).all() as unknown[]).toEqual([]);
        reopened.close();
      } finally {
        copied.cleanup();
      }
    },
  );

  it.each(RELEASED_FIXTURE_VERSIONS)(
    "upgrades the released v%s password fixture, preserves auth data, and converges with a fresh schema",
    async (version) => {
      const copied = copyFixture(`v${version}-password.db`);
      try {
        const released = new DatabaseSync(copied.path, { readOnly: true });
        expect(
          (
            released.prepare(`PRAGMA user_version`).get() as {
              user_version: number;
            }
          ).user_version,
        ).toBe(version);
        const originalUsers = released.prepare(`SELECT id, email FROM user ORDER BY id`).all();
        const originalSessions = released.prepare(`SELECT id, userId FROM session ORDER BY id`).all();
        const originalValues = captureMigrationValues(released);
        released.close();

        const db = openDb(copied.path);
        const configured = authFromEnv(db, FIXTURE_PASSWORD_ENV);
        await runAuthMigrations(configured.auth!);
        assertMigrationValuesPreserved(originalValues, captureMigrationValues(db), version);
        expect(db.prepare(`SELECT id, email FROM user ORDER BY id`).all()).toEqual(originalUsers);
        expect(db.prepare(`SELECT id, userId FROM session ORDER BY id`).all()).toEqual(originalSessions);
        expect((db.prepare(`SELECT email FROM user`).get() as { email: string }).email).toBe("fixture@example.invalid");
        expect((db.prepare(`PRAGMA quick_check`).get() as { quick_check: string }).quick_check).toBe("ok");
        expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
        if (version === 12) {
          expect(db.prepare(`SELECT checksum FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 11`).get()).toEqual({
            checksum: "057242fc8e358bebf0a188395e9289d2661f6a89e843bc091e718d003f013f5e",
          });
        }

        const fresh = openDb(":memory:");
        const freshConfigured = authFromEnv(fresh, FIXTURE_PASSWORD_ENV);
        await runAuthMigrations(freshConfigured.auth!);
        expect(schemaFingerprint(db)).toEqual(schemaFingerprint(fresh));
        fresh.close();
        db.close();

        const reopened = openDb(copied.path);
        const reopenedConfigured = authFromEnv(reopened, FIXTURE_PASSWORD_ENV);
        await runAuthMigrations(reopenedConfigured.auth!);
        expect(planDatabaseMigrations(reopened).migrations).toEqual([]);
        expect(reopened.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
        reopened.close();
      } finally {
        copied.cleanup();
      }
    },
  );

  it("rejects an unapproved same-row-count value change after a released-fixture upgrade", () => {
    const copied = copyFixture("v12-off.db");
    try {
      const released = new DatabaseSync(copied.path, { readOnly: true });
      const originalValues = captureMigrationValues(released);
      released.close();

      const upgraded = openDb(copied.path);
      expect(() => assertMigrationValuesPreserved(originalValues, captureMigrationValues(upgraded), 12)).not.toThrow();
      expect(
        upgraded.prepare(`UPDATE projects SET name = ? WHERE id = ?`).run("Unapproved rewrite", "p-acme").changes,
      ).toBe(1);
      expect(() => assertMigrationValuesPreserved(originalValues, captureMigrationValues(upgraded), 12)).toThrow(
        /changed unapproved projects\.name/i,
      );
      upgraded.close();
    } finally {
      copied.cleanup();
    }
  });
});

describe("migration ledger checksum supersession (v11 alpha-line amendment)", () => {
  // v11's definition was amended IN PLACE ('…promote-oldest…:v1' → '…promote-highest-role-tier…:v2').
  // Any DB upgraded by the PREVIOUS build recorded this OLD checksum in its ledger; the supersession
  // allow-list must accept exactly this one historical value for v11, and nothing else.
  const OLD_V11_CHECKSUM = "057242fc8e358bebf0a188395e9289d2661f6a89e843bc091e718d003f013f5e";

  it("boots a database whose v11 ledger row carries the superseded old-v11 checksum", () => {
    const path = join(tmpdir(), `capacitylens-superseded-v11-${process.pid}-${Date.now()}.db`);
    const cleanup = () => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          unlinkSync(path + suffix);
        } catch {
          /* not present */
        }
      }
    };
    cleanup();
    try {
      const seeded = openDb(path);
      insertRow(seeded, "accounts", {
        id: "a1",
        name: "Studio",
        color: "#e02727",
        createdAt: TS,
        updatedAt: TS,
      });
      // Model the already-upgraded install: rewrite v11 to the checksum the previous build stamped.
      seeded.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = 11`).run(OLD_V11_CHECKSUM);
      seeded.close();

      // The real boot path (openDb → planDatabaseMigrations → assertMigrationHistory) must NOT throw.
      const rebooted = openDb(path);
      expect(planDatabaseMigrations(rebooted).migrations).toEqual([]);
      // Subsequent behaviour is normal: the data is intact and the DB stays writable.
      expect(loadState(rebooted).accounts.find((a) => a.id === "a1")?.name).toBe("Studio");
      insertRow(rebooted, "accounts", {
        id: "a2",
        name: "Second",
        color: "#2d75da",
        createdAt: TS,
        updatedAt: TS,
      });
      expect(getRow(rebooted, "accounts", "a2")?.name).toBe("Second");
      // The ledger row is LEFT UNTOUCHED — we accept the superseded checksum, we don't rewrite history.
      expect(rebooted.prepare(`SELECT checksum FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 11`).get()).toEqual({
        checksum: OLD_V11_CHECKSUM,
      });
      rebooted.close();
    } finally {
      cleanup();
    }
  });

  it("still refuses a genuinely wrong v11 checksum (neither the old nor the current definition)", () => {
    const db = openDb(":memory:");
    db.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = 11`).run("1".repeat(64));
    expect(() => planDatabaseMigrations(db)).toThrow(/v11 checksum does not match/i);
    db.close();
  });

  it("is v11-only: the same old-v11 checksum on a different version still refuses startup", () => {
    const db = openDb(":memory:");
    // The allow-list is per-version. The v11 historical checksum on v12 is NOT allow-listed there.
    db.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = 12`).run(OLD_V11_CHECKSUM);
    expect(() => planDatabaseMigrations(db)).toThrow(/v12 checksum does not match/i);
    db.close();
  });
});

describe("v13 migration is self-contained (frozen palette folded into the checksum)", () => {
  it("embeds the frozen palette digest in the v13 definition string", () => {
    // The definition folds in the joined frozen-palette hex list so the migration CHECKSUM covers the
    // exact palette the repair snaps to — a future shared-palette edit can't silently change v13.
    expect(V13_DEFINITION).toContain(V13_FROZEN_PRESET_COLORS.join(","));
    expect(V13_DEFINITION).toContain("#7adae3"); // spot-check a representative preset is in the digest
  });

  it("froze the palette byte-for-byte from the shared palette at authoring time", () => {
    // Authoring-time snapshot check: the frozen copy equalled shared PRESET_COLORS when v13 was
    // written. If shared PRESET_COLORS is ever edited and this fails, the fix is a NEW migration with
    // its own frozen list + checksum — NOT updating this frozen list (that would silently rewrite an
    // already-checksummed step). See V13_FROZEN_PRESET_COLORS in db.ts.
    expect(V13_FROZEN_PRESET_COLORS).toEqual(PRESET_COLORS);
  });
});
