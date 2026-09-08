import { describe, expect, it } from "vitest";
import { openDb, type Db } from "./db";
import { CROSS_TENANT_ERASURE_EDGE_SQL, eraseWorkspaceProductDataInTx, TenantErasureIntegrityError } from "./erasure";
import { tx } from "./txn";
import { recordAppliedSyncBatch } from "./syncOrdering";

const TS = "2026-01-01T00:00:00.000Z";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected a database row.");
  }
  return value;
}

function readString(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    throw new Error(`Expected database field ${field} to be a string.`);
  }
  return value[field];
}

function readErrorMessage(value: unknown): string {
  if (!(value instanceof Error)) {
    throw new Error("Expected erasure to throw an Error.");
  }
  return value.message;
}

function seedAccounts(db: Db): void {
  const insert = db.prepare(
    `INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, '#3b82f6', ?, ?)`,
  );
  insert.run("a1", "Target", TS, TS);
  insert.run("a2", "Other", TS, TS);
}

function insertClient(db: Db, id: string, accountId: string): void {
  db.prepare(
    `
    INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt)
    VALUES (?, ?, ?, '#3b82f6', ?, ?)
  `,
  ).run(id, accountId, id, TS, TS);
}

function insertDiscipline(db: Db, id: string, accountId: string): void {
  db.prepare(
    `
    INSERT INTO disciplines (id, accountId, name, sortOrder, createdAt, updatedAt)
    VALUES (?, ?, ?, 0, ?, ?)
  `,
  ).run(id, accountId, id, TS, TS);
}

interface InsertProjectInput {
  db: Db;
  id: string;
  accountId: string;
  clientId: string;
}

function insertProject({ db, id, accountId, clientId }: InsertProjectInput): void {
  db.prepare(
    `
    INSERT INTO projects (id, accountId, name, clientId, color, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, '#3b82f6', ?, ?)
  `,
  ).run(id, accountId, id, clientId, TS, TS);
}

interface InsertPhaseInput {
  db: Db;
  id: string;
  accountId: string;
  projectId: string;
}

function insertPhase({ db, id, accountId, projectId }: InsertPhaseInput): void {
  db.prepare(
    `
    INSERT INTO phases (id, accountId, name, projectId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, accountId, id, projectId, TS, TS);
}

interface InsertResourceInput {
  db: Db;
  id: string;
  accountId: string;
  refs?: { disciplineId?: string; projectId?: string } | undefined;
}

function insertResource({ db, id, accountId, refs }: InsertResourceInput): void {
  db.prepare(
    `
    INSERT INTO resources (
      id, accountId, kind, name, role, disciplineId, employmentType, workingHoursPerDay,
      workingDays, projectId, color, createdAt, updatedAt
    ) VALUES (?, ?, 'person', ?, 'Designer', ?, 'employee', 8, '[1,2,3,4,5]', ?, '#3b82f6', ?, ?)
  `,
  ).run(id, accountId, id, refs?.disciplineId ?? null, refs?.projectId ?? null, TS, TS);
}

interface InsertActivityInput {
  db: Db;
  id: string;
  accountId: string;
  refs?: { projectId?: string; phaseId?: string } | undefined;
}

function insertActivity({ db, id, accountId, refs }: InsertActivityInput): void {
  db.prepare(
    `
    INSERT INTO activities (id, accountId, name, kind, projectId, phaseId, createdAt, updatedAt)
    VALUES (?, ?, ?, 'internal', ?, ?, ?, ?)
  `,
  ).run(id, accountId, id, refs?.projectId ?? null, refs?.phaseId ?? null, TS, TS);
}

interface InsertAllocationInput {
  db: Db;
  id: string;
  accountId: string;
  resourceId: string;
  activityId: string;
  projectId?: string | undefined;
}

function insertAllocation({ db, id, accountId, resourceId, activityId, projectId }: InsertAllocationInput): void {
  db.prepare(
    `
    INSERT INTO allocations (
      id, accountId, resourceId, activityId, projectId, startDate, endDate, hoursPerDay, status,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, '2026-01-05', '2026-01-09', 8, 'confirmed', ?, ?)
  `,
  ).run(id, accountId, resourceId, activityId, projectId ?? null, TS, TS);
}

interface InsertTimeOffInput {
  db: Db;
  id: string;
  accountId: string;
  resourceId: string;
}

function insertTimeOff({ db, id, accountId, resourceId }: InsertTimeOffInput): void {
  db.prepare(
    `
    INSERT INTO timeOff (
      id, accountId, resourceId, startDate, endDate, type, createdAt, updatedAt
    ) VALUES (?, ?, ?, '2026-01-05', '2026-01-05', 'holiday', ?, ?)
  `,
  ).run(id, accountId, resourceId, TS, TS);
}

const crossTenantEdges: Array<{
  relationship: string;
  seed(db: Db): void;
}> = [
  {
    relationship: "resources.disciplineId -> disciplines.id",
    seed(db) {
      insertDiscipline(db, "d1", "a1");
      insertResource({ db, id: "r2", accountId: "a2", refs: { disciplineId: "d1" } });
    },
  },
  {
    relationship: "projects.clientId -> clients.id",
    seed(db) {
      insertClient(db, "c1", "a1");
      insertProject({ db, id: "p2", accountId: "a2", clientId: "c1" });
    },
  },
  {
    relationship: "phases.projectId -> projects.id",
    seed(db) {
      insertClient(db, "c1", "a1");
      insertProject({ db, id: "p1", accountId: "a1", clientId: "c1" });
      insertPhase({ db, id: "ph2", accountId: "a2", projectId: "p1" });
    },
  },
  {
    relationship: "resources.projectId -> projects.id",
    seed(db) {
      insertClient(db, "c1", "a1");
      insertProject({ db, id: "p1", accountId: "a1", clientId: "c1" });
      insertResource({ db, id: "r2", accountId: "a2", refs: { projectId: "p1" } });
    },
  },
  {
    relationship: "activities.projectId -> projects.id",
    seed(db) {
      insertClient(db, "c1", "a1");
      insertProject({ db, id: "p1", accountId: "a1", clientId: "c1" });
      insertActivity({ db, id: "act2", accountId: "a2", refs: { projectId: "p1" } });
    },
  },
  {
    relationship: "activities.phaseId -> phases.id",
    seed(db) {
      insertClient(db, "c1", "a1");
      insertProject({ db, id: "p1", accountId: "a1", clientId: "c1" });
      insertPhase({ db, id: "ph1", accountId: "a1", projectId: "p1" });
      insertClient(db, "c2", "a2");
      insertProject({ db, id: "p2", accountId: "a2", clientId: "c2" });
      insertActivity({ db, id: "act2", accountId: "a2", refs: { projectId: "p2", phaseId: "ph1" } });
    },
  },
  {
    relationship: "allocations.resourceId -> resources.id",
    seed(db) {
      insertResource({ db, id: "r1", accountId: "a1" });
      insertActivity({ db, id: "act2", accountId: "a2" });
      insertAllocation({ db, id: "al2", accountId: "a2", resourceId: "r1", activityId: "act2" });
    },
  },
  {
    relationship: "allocations.activityId -> activities.id",
    seed(db) {
      insertResource({ db, id: "r2", accountId: "a2" });
      insertActivity({ db, id: "act1", accountId: "a1" });
      insertAllocation({ db, id: "al2", accountId: "a2", resourceId: "r2", activityId: "act1" });
    },
  },
  {
    relationship: "timeOff.resourceId -> resources.id",
    seed(db) {
      insertResource({ db, id: "r1", accountId: "a1" });
      insertTimeOff({ db, id: "to2", accountId: "a2", resourceId: "r1" });
    },
  },
  {
    relationship: "allocations.projectId -> projects.id",
    seed(db) {
      insertClient(db, "c1", "a1");
      insertProject({ db, id: "p1", accountId: "a1", clientId: "c1" });
      insertResource({ db, id: "r2", accountId: "a2" });
      insertActivity({ db, id: "act2", accountId: "a2" });
      insertAllocation({ db, id: "al2", accountId: "a2", resourceId: "r2", activityId: "act2", projectId: "p1" });
    },
  },
];

const EXPECTED_CROSS_TENANT_ERASURE_EDGE_SQL = `
  SELECT 'resources.disciplineId -> disciplines.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM disciplines AS parent
    JOIN resources AS child ON child.disciplineId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'projects.clientId -> clients.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM clients AS parent
    JOIN projects AS child ON child.clientId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'phases.projectId -> projects.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM projects AS parent
    JOIN phases AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'resources.projectId -> projects.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM projects AS parent
    JOIN resources AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'activities.projectId -> projects.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM projects AS parent
    JOIN activities AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'activities.phaseId -> phases.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM phases AS parent
    JOIN activities AS child ON child.phaseId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'allocations.resourceId -> resources.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM resources AS parent
    JOIN allocations AS child ON child.resourceId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'allocations.activityId -> activities.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM activities AS parent
    JOIN allocations AS child ON child.activityId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'timeOff.resourceId -> resources.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM resources AS parent
    JOIN timeOff AS child ON child.resourceId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'allocations.projectId -> projects.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM projects AS parent
    JOIN allocations AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  LIMIT 1`;

describe("CROSS_TENANT_ERASURE_EDGE_SQL", () => {
  // Pinned so a future edit to tenantIntegrity's TENANT_RELATIONSHIPS (the shared source this SQL is
  // now generated from) can't silently change the erasure guard's query shape. Content is provably
  // equivalent to the hand-written SQL this replaced: same relationships, same order, same per-branch
  // WHERE clause — only the repeated column aliases differ, which UNION ALL ignores past the first
  // SELECT. The it.each coverage below is the behavioural proof; this is the textual regression pin.
  it("generates one account-scoped edge check per TENANT_RELATIONSHIPS entry, in order", () => {
    expect(CROSS_TENANT_ERASURE_EDGE_SQL).toBe(EXPECTED_CROSS_TENANT_ERASURE_EDGE_SQL);
  });
});

function testExistingTransactionRequirement(): void {
  const db = openDb(":memory:");
  seedAccounts(db);

  expect(() => eraseWorkspaceProductDataInTx(db, "a1")).toThrow(
    "Workspace product-data erasure must run inside an existing transaction.",
  );
  expect(db.prepare(`SELECT id FROM accounts ORDER BY id`).all()).toEqual([{ id: "a1" }, { id: "a2" }]);
  db.close();
}

function testCrossTenantEdgeRefusal({ relationship, seed }: (typeof crossTenantEdges)[number]): void {
  const db = openDb(":memory:");
  seedAccounts(db);
  // Current v19 databases reject these edges at write time and on boot. Remove only the insert
  // guards to model post-start operator tampering and retain the erasure layer's last-ditch
  // containment coverage for every relationship.
  const insertTriggers = db
    .prepare(
      `
      SELECT name FROM sqlite_master
       WHERE type = 'trigger'
         AND name LIKE 'capacitylens_tenant_%_insert'
    `,
    )
    .all()
    .map((row: unknown) => readString(row, "name"));
  for (const name of insertTriggers) db.exec(`DROP TRIGGER ${name}`);
  seed(db);

  // The remaining id-only foreign keys consider the relationship structurally valid. Even after
  // trigger tampering, erasure remains the final containment boundary before a cascade can cross.
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

  let thrown: unknown;
  try {
    tx(db, () => eraseWorkspaceProductDataInTx(db, "a1"));
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(TenantErasureIntegrityError);
  expect(readErrorMessage(thrown)).toContain(relationship);
  expect(db.prepare(`SELECT id FROM accounts ORDER BY id`).all()).toEqual([{ id: "a1" }, { id: "a2" }]);
}

function testScopedSyncProvenanceRemoval(): void {
  const db = openDb(":memory:");
  seedAccounts(db);
  insertClient(db, "c1", "a1");
  insertClient(db, "c2", "a2");
  recordAppliedSyncBatch(db, { sessionId: "browser-session-a1", sequence: 1 }, [
    {
      table: "clients",
      id: "c1",
      accountId: "a1",
      row: readRecord(db.prepare(`SELECT * FROM clients WHERE id = 'c1'`).get()),
    },
  ]);
  recordAppliedSyncBatch(db, { sessionId: "browser-session-a2", sequence: 1 }, [
    {
      table: "clients",
      id: "c2",
      accountId: "a2",
      row: readRecord(db.prepare(`SELECT * FROM clients WHERE id = 'c2'`).get()),
    },
  ]);

  tx(db, () => eraseWorkspaceProductDataInTx(db, "a1"));

  expect(
    db
      .prepare(
        `
      SELECT tableName, rowId, accountId
        FROM capacitylens_sync_row_provenance
       ORDER BY rowId
    `,
      )
      .all(),
  ).toEqual([{ tableName: "clients", rowId: "c2", accountId: "a2" }]);
}

function registerWorkspaceErasureTenantBoundaryGuardTests(): void {
  it("refuses to erase product data outside an existing transaction", testExistingTransactionRequirement);
  it.each(crossTenantEdges)("refuses $relationship", testCrossTenantEdgeRefusal);
  it("removes only the erased workspace sync provenance", testScopedSyncProvenanceRemoval);
}

describe("workspace erasure tenant-boundary guard", registerWorkspaceErasureTenantBoundaryGuardTests);
