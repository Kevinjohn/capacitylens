import { describe, it, expect } from "vitest";
import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
} from "@capacitylens/shared/lib/integrity";
import { deleteAccountCascade } from "@capacitylens/shared/domain/mutations";
import { deleteRow, insertAll, loadState, openDb, type Db } from "./db";
import { sqliteTenantStore } from "./tenantStore";

// CASCADE PARITY (differential test).
//
// Delete semantics live in THREE places that can silently drift apart:
//   1. the shared TS `delete*Cascade` transforms (shared/src/lib/integrity.ts) the demo-build store uses,
//   2. the SQLite FK ON DELETE CASCADE / SET NULL clauses (tables.ts SCHEMA_V8_SQL),
//   3. the bespoke restamp SQL in purgeLifecycleRow (tenantStore.ts) that bumps updatedAt on the
//      survivors SQLite silently unbinds.
// A rule changed in one place but not the others makes a local delete and a server purge leave
// DIFFERENT surviving rows, so a syncing client sees orphaned or resurrected children.
//
// Rather than generate all three from one source (over-engineering for a schema this stable), this
// suite runs the SAME fixture through the TS transform and through the real database, then asserts
// the surviving rows match: ids, the FK columns each side is supposed to clear, and — on the purge
// paths — WHICH rows were restamped. The exact revision value differs by construction (the store
// passes its own clock, the server derives nextServerRevision), so parity is asserted on "was this
// row restamped", not on the literal timestamp.

const ACCOUNT = "a1";
/** A second, untouched tenant: every case below must leave its rows exactly as seeded. */
const OTHER_ACCOUNT = "a2";
const SEEDED_AT = "2026-01-01T00:00:00.000Z";
/** The revision the TS cascades stamp on survivors — any value later than SEEDED_AT works. */
const REV = "2026-06-01T00:00:00.000Z";
const meta = { createdAt: SEEDED_AT, updatedAt: SEEDED_AT };

/**
 * One account whose graph exercises every cascade edge at once, including the awkward ones:
 * an activity that belongs to project p3 but sits in a PHASE of p1 (survives a p1 delete with its
 * phaseId unbound), an internal activity with no project in that same phase, placeholders bound to
 * two different projects, and allocations/time off hanging off the resources.
 */
function seed(): AppData {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [
    { id: ACCOUNT, name: "Studio", color: "#3b82f6", ...meta },
    { id: OTHER_ACCOUNT, name: "Neighbour", color: "#f97316", ...meta },
  ];
  d.clients = [
    { id: "c1", accountId: ACCOUNT, name: "Acme", color: "#3b82f6", ...meta },
    { id: "c2", accountId: ACCOUNT, name: "Other", color: "#22c55e", ...meta },
    { id: "c9", accountId: OTHER_ACCOUNT, name: "Neighbour co", color: "#f97316", ...meta },
  ];
  d.disciplines = [{ id: "d1", accountId: ACCOUNT, name: "Design", sortOrder: 0, ...meta }];
  d.projects = [
    { id: "p1", accountId: ACCOUNT, name: "Web", clientId: "c1", color: "#3b82f6", ...meta },
    { id: "p2", accountId: ACCOUNT, name: "App", clientId: "c1", color: "#3b82f6", ...meta },
    { id: "p3", accountId: ACCOUNT, name: "Ops", clientId: "c2", color: "#22c55e", ...meta },
    { id: "p9", accountId: OTHER_ACCOUNT, name: "Theirs", clientId: "c9", color: "#f97316", ...meta },
  ];
  d.phases = [
    { id: "ph1", accountId: ACCOUNT, name: "Build", projectId: "p1", ...meta },
    { id: "ph2", accountId: ACCOUNT, name: "Build", projectId: "p2", ...meta },
    { id: "ph3", accountId: ACCOUNT, name: "Build", projectId: "p3", ...meta },
  ];
  const resource = (id: string, extra: Record<string, unknown>) => ({
    id,
    accountId: ACCOUNT,
    kind: "person",
    role: "Designer",
    employmentType: "permanent",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#3b82f6",
    ...extra,
    ...meta,
  });
  d.resources = [
    resource("r1", { disciplineId: "d1" }),
    // Placeholders bound to a project — the SET NULL / unbind (never delete) rule.
    resource("r2", { kind: "placeholder", projectId: "p1", disciplineId: "d1" }),
    resource("r3", { kind: "placeholder", projectId: "p3" }),
    resource("r9", { accountId: OTHER_ACCOUNT, projectId: "p9" }),
  ];
  d.activities = [
    { id: "t1", accountId: ACCOUNT, name: "Design", kind: "project", projectId: "p1", phaseId: "ph1", ...meta },
    { id: "t2", accountId: ACCOUNT, name: "Build", kind: "project", projectId: "p2", phaseId: "ph2", ...meta },
    // Belongs to p3 but lives in a phase of p1: must SURVIVE a p1 delete with phaseId unbound.
    { id: "t3", accountId: ACCOUNT, name: "Support", kind: "project", projectId: "p3", phaseId: "ph1", ...meta },
    // Project-less (internal) activity in a phase of p1: same survivor-with-unbound-phase rule.
    { id: "t4", accountId: ACCOUNT, name: "Admin", kind: "internal", phaseId: "ph1", ...meta },
    { id: "t9", accountId: OTHER_ACCOUNT, name: "Theirs", kind: "project", projectId: "p9", ...meta },
  ];
  const allocation = (id: string, resourceId: string, activityId: string, accountId = ACCOUNT) => ({
    id,
    accountId,
    resourceId,
    activityId,
    startDate: "2026-01-01",
    endDate: "2026-01-05",
    hoursPerDay: 8,
    status: "confirmed",
    ...meta,
  });
  d.allocations = [
    allocation("al1", "r1", "t1"),
    allocation("al2", "r1", "t2"),
    allocation("al3", "r2", "t3"),
    allocation("al4", "r3", "t4"),
    allocation("al9", "r9", "t9", OTHER_ACCOUNT),
  ];
  const off = (id: string, resourceId: string, accountId = ACCOUNT) => ({
    id,
    accountId,
    resourceId,
    startDate: "2026-02-01",
    endDate: "2026-02-03",
    type: "vacation",
    ...meta,
  });
  d.timeOff = [off("to1", "r1"), off("to2", "r2"), off("to9", "r9", OTHER_ACCOUNT)];
  return d as unknown as AppData;
}

/** The FK columns whose clearing (SET NULL / unbind) is part of each table's cascade contract. */
const FK_COLUMNS = {
  accounts: [],
  clients: ["accountId"],
  disciplines: ["accountId"],
  projects: ["accountId", "clientId"],
  phases: ["accountId", "projectId"],
  resources: ["accountId", "disciplineId", "projectId"],
  activities: ["accountId", "projectId", "phaseId"],
  allocations: ["accountId", "resourceId", "activityId"],
  timeOff: ["accountId", "resourceId"],
} as const satisfies Record<string, readonly string[]>;

type Survivors = Record<string, Array<Record<string, unknown>>>;

/**
 * The comparable shape of a post-delete dataset: per table, the surviving rows by id with their FK
 * columns (absent normalised to null, since the DB omits an optional column the TS side sets to
 * `undefined`) and, when `withRestamps`, whether the row's updatedAt moved off the seeded value.
 */
function survivors(data: AppData, withRestamps: boolean): Survivors {
  const source = data as unknown as Record<string, Array<Record<string, unknown>>>;
  const out: Survivors = {};
  for (const [table, columns] of Object.entries(FK_COLUMNS)) {
    out[table] = (source[table] ?? [])
      .map((row) => ({
        id: row.id,
        ...Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
        ...(withRestamps ? { restamped: row.updatedAt !== SEEDED_AT } : {}),
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

function withSeededDb<T>(use: (db: Db) => T): T {
  // openDb(':memory:') turns PRAGMA foreign_keys ON — without it the FK actions never fire.
  const db = openDb(":memory:");
  try {
    insertAll(db, seed());
    return use(db);
  } finally {
    db.close();
  }
}

/**
 * Run the same delete both ways and compare the survivors.
 * @param sql  the real database path — a purge through the TenantStore, or a plain deleteRow for a
 *             table with no lifecycle purge (where only the FK clauses act).
 */
function expectParity(
  transform: (data: AppData) => AppData,
  sql: (db: Db) => void,
  { withRestamps }: { withRestamps: boolean },
): void {
  const fromDatabase = withSeededDb((db) => {
    sql(db);
    return survivors(loadState(db), withRestamps);
  });
  expect(fromDatabase).toEqual(survivors(transform(seed()), withRestamps));
}

const purge = (entity: "resources" | "clients" | "projects", id: string) => (db: Db) => {
  const result = sqliteTenantStore(db).purgeLifecycleRow(ACCOUNT, entity, id);
  // A null result means the row was not found/owned — the parity assertion would then trivially
  // "pass" against an untouched database, so fail loudly here instead.
  expect(result).not.toBeNull();
};

describe("cascade parity — shared TS transforms vs. the real SQLite path", () => {
  it("deleting a project leaves the same rows (CASCADE children, SET NULL survivors)", () => {
    expectParity((data) => deleteProjectCascade(data, "p1", REV), purge("projects", "p1"), { withRestamps: true });
  });

  it("deleting a client leaves the same rows (projects → phases → activities → allocations)", () => {
    expectParity((data) => deleteClientCascade(data, "c1", REV), purge("clients", "c1"), { withRestamps: true });
  });

  it("deleting a resource leaves the same rows (allocations + time off cascade)", () => {
    expectParity((data) => deleteResourceCascade(data, "r2"), purge("resources", "r2"), { withRestamps: true });
  });

  // Disciplines carry no tombstone (LIFECYCLE_ENTITY_KEYS is resources/clients/projects only), so
  // there is no purge branch to restamp survivors: the FK's SET NULL is the whole server rule and
  // the caller owns the revision. Parity is therefore asserted on the surviving rows and cleared
  // columns, not on restamps.
  it("deleting a discipline ungroups its resources rather than deleting them (SET NULL)", () => {
    expectParity(
      (data) => deleteDisciplineCascade(data, "d1", REV),
      (db) => deleteRow(db, "disciplines", "d1"),
      {
        withRestamps: false,
      },
    );
  });

  // Same story as disciplines: no tombstone, so the FK's SET NULL is the whole server rule.
  it("deleting a phase ungroups its activities rather than deleting them (SET NULL)", () => {
    expectParity(
      (data) => deletePhaseCascade(data, "ph1", REV),
      (db) => deleteRow(db, "phases", "ph1"),
      {
        withRestamps: false,
      },
    );
  });

  // The account-scoped transform lives in shared/domain/mutations.ts, not integrity.ts, but it is
  // the fourth implementation of the same contract (every scoped table's accountId FK CASCADEs).
  it("deleting an account removes exactly its scoped rows and leaves the other tenant intact", () => {
    expectParity(
      (data) => deleteAccountCascade(data, ACCOUNT),
      (db) => deleteRow(db, "accounts", ACCOUNT),
      {
        withRestamps: false,
      },
    );
  });
});
