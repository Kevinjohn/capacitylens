import { afterEach, describe, it, expect, expectTypeOf } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppData } from "@capacitylens/shared/types/entities";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import {
  openDb as openDbRaw,
  insertAll,
  insertRow,
  loadState,
  readSlice,
  type CompleteAccountSlice,
  type Db,
  validatedCompleteAccountSlice,
} from "./db";
import { sqliteTenantStore } from "./tenantStore";
import { tx } from "./txn";

const openDatabases = new Set<Db>();
const openDb = (...args: Parameters<typeof openDbRaw>): Db => {
  const db = openDbRaw(...args);
  openDatabases.add(db);
  return db;
};

afterEach(() => {
  for (const db of openDatabases) {
    if (db.isOpen) db.close();
  }
  expect([...openDatabases].every((db) => !db.isOpen)).toBe(true);
  openDatabases.clear();
});

// P1.4: prove the per-account scoped read primitive (readSlice) + the TenantStore seam isolate one
// account's slice and NEVER leak another tenant's rows — the no-cross-tenant invariant the whole
// tenancy seam rests on. Mirrors app.test.ts's openDb(':memory:') + plain-row fixture pattern; seeds
// directly via insertAll (parent-first) so it tests the db layer, not the routes.

const TS = "2026-01-01T00:00:00.000Z";
const meta = () => ({ createdAt: TS, updatedAt: TS });

const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  ...meta(),
});
const client = (id: string, accountId: string) => ({
  id,
  accountId,
  name: "Acme",
  color: "#3b82f6",
  ...meta(),
});
const discipline = (id: string, accountId: string) => ({
  id,
  accountId,
  name: "Design",
  sortOrder: 0,
  ...meta(),
});
const project = (id: string, accountId: string, clientId: string) => ({
  id,
  accountId,
  name: "Web",
  clientId,
  color: "#3b82f6",
  ...meta(),
});
const phase = (id: string, accountId: string, projectId: string) => ({
  id,
  accountId,
  name: "Build",
  projectId,
  ...meta(),
});
const person = (id: string, accountId: string, disciplineId?: string) => ({
  id,
  accountId,
  kind: "person",
  role: "Designer",
  disciplineId,
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  // json column — must round-trip through the codec.
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [2],
  color: "#3b82f6",
  ...meta(),
});
const activity = (id: string, accountId: string, projectId: string) => ({
  id,
  accountId,
  name: "Activity",
  kind: "project",
  projectId,
  ...meta(),
});
const allocation = (id: string, accountId: string, resourceId: string, activityId: string) => ({
  id,
  accountId,
  resourceId,
  activityId,
  startDate: "2026-01-01",
  endDate: "2026-01-05",
  hoursPerDay: 8,
  status: "confirmed",
  // optional note + json ignoreWeekends — exercise the codec round-trip.
  note: "hi",
  ignoreWeekends: true,
  ...meta(),
});
const timeOff = (id: string, accountId: string, resourceId: string, note?: string) => ({
  id,
  accountId,
  resourceId,
  startDate: "2026-02-01",
  endDate: "2026-02-03",
  type: "vacation",
  // optional, owner/admin-only note — exercises the P1.6 field-redaction in readSlice.
  ...(note !== undefined ? { note } : {}),
  ...meta(),
});

/** All readSlice calls below pass includeTimeOffNote (REQUIRED, P1.6) AND includeInactive (REQUIRED,
 *  P2.4); the isolation/shape tests want the FULL slice, so they pass both `true` (every note + every
 *  archived/deleted row). The note redaction (P1.6) and the lifecycle projection (P2.4) each get their
 *  own describe block where the relevant flag is flipped. */
const FULL = {
  includeTimeOffNote: true,
  includeInactive: true,
  includePrivateNames: true,
} as const;

/** A full two-account dataset: a1 and a2 each carry rows in every scoped table. */
function seedTwoAccounts(): AppData {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [account("a1"), account("a2")];
  d.clients = [client("c1", "a1"), client("c2", "a2")];
  d.disciplines = [discipline("d1", "a1"), discipline("d2", "a2")];
  d.projects = [project("p1", "a1", "c1"), project("p2", "a2", "c2")];
  d.phases = [phase("ph1", "a1", "p1"), phase("ph2", "a2", "p2")];
  d.resources = [person("r1", "a1", "d1"), person("r2", "a2", "d2")];
  d.activities = [activity("act1", "a1", "p1"), activity("act2", "a2", "p2")];
  d.allocations = [allocation("al1", "a1", "r1", "act1"), allocation("al2", "a2", "r2", "act2")];
  d.timeOff = [timeOff("to1", "a1", "r1"), timeOff("to2", "a2", "r2")];
  return d as unknown as AppData;
}

const SCOPED_KEYS = [
  "clients",
  "disciplines",
  "projects",
  "phases",
  "resources",
  "activities",
  "allocations",
  "timeOff",
] as const;

describe("readSlice — tenant isolation", () => {
  it("returns ONLY the requested account in every table (a1)", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const slice = readSlice(db, "a1", FULL);
    expect(slice.accounts.map((a) => a.id)).toEqual(["a1"]);
    for (const key of SCOPED_KEYS) {
      const rows = slice[key];
      expect(rows.length).toBe(1);
      // ZERO rows from a2 in any scoped table — the no-cross-tenant invariant.
      expect(rows.every((r) => (r as { accountId: string }).accountId === "a1")).toBe(true);
    }
  });

  it("is symmetric for a2 (no a1 rows leak)", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const slice = readSlice(db, "a2", FULL);
    expect(slice.accounts.map((a) => a.id)).toEqual(["a2"]);
    for (const key of SCOPED_KEYS) {
      expect(slice[key].every((r) => (r as { accountId: string }).accountId === "a2")).toBe(true);
      expect(slice[key].some((r) => (r as { accountId: string }).accountId === "a1")).toBe(false);
    }
  });

  it("unknown accountId → empty slice (accounts:[], every scoped array empty), no throw", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const slice = readSlice(db, "does-not-exist", FULL);
    expect(slice.accounts).toEqual([]);
    for (const key of SCOPED_KEYS) expect(slice[key]).toEqual([]);
    // Result has EVERY AppData key present (starts from emptyAppData), not a partial object.
    expect(Object.keys(slice).sort()).toEqual(Object.keys(emptyAppData()).sort());
  });

  it("round-trips optional + json columns through the codec", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const slice = readSlice(db, "a1", FULL);
    // Both weekday JSON arrays + omitted optionals survive exactly (deep-equals the seeded object).
    expect(slice.resources[0]).toEqual(person("r1", "a1", "d1"));
    // optional note + json ignoreWeekends survive.
    expect(slice.allocations[0]).toEqual(allocation("al1", "a1", "r1", "act1"));
  });

  it("returns one WAL snapshot when another handle commits between scoped table reads", () => {
    const directory = mkdtempSync(join(tmpdir(), "capacitylens-slice-snapshot-"));
    const path = join(directory, "capacitylens.db");
    const reader = openDb(path);
    const writer = openDb(path);
    const initial = emptyAppData() as unknown as Record<string, unknown[]>;
    initial.accounts = [account("a1")];
    insertAll(reader, initial as unknown as AppData);
    let injected = false;
    const observedReader = new Proxy(reader, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (/^SELECT \* FROM clients WHERE accountId = \?$/.test(sql)) {
              return new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "all") {
                    return (...args: Parameters<typeof statementTarget.all>) => {
                      const rows = statementTarget.all(...args);
                      tx(writer, () => {
                        insertRow(writer, "clients", client("committed-client", "a1"));
                        insertRow(writer, "projects", project("committed-project", "a1", "committed-client"));
                      });
                      injected = true;
                      return rows;
                    };
                  }
                  const value = Reflect.get(statementTarget, statementProperty, statementTarget) as unknown;
                  return typeof value === "function" ? value.bind(statementTarget) : value;
                },
              });
            }
            return statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Db;

    try {
      const slice = readSlice(observedReader, "a1", FULL);

      expect(injected).toBe(true);
      expect(slice.clients).toEqual([]);
      expect(slice.projects).toEqual([]);
      expect(readSlice(writer, "a1", FULL).clients.map((row) => row.id)).toEqual(["committed-client"]);
      expect(readSlice(writer, "a1", FULL).projects.map((row) => row.id)).toEqual(["committed-project"]);
    } finally {
      reader.close();
      writer.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("sqliteTenantStore", () => {
  it("keeps projected reads type-incompatible with complete replacement input", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const store = sqliteTenantStore(db);

    expectTypeOf(store.readSlice("a1", FULL)).not.toMatchTypeOf<CompleteAccountSlice>();
    expectTypeOf(store.readFullSlice("a1")).toMatchTypeOf<CompleteAccountSlice>();
    db.close();
  });

  it("readSlice(id) equals the standalone readSlice(db, id)", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const storeSlice = sqliteTenantStore(db).readSlice("a1", FULL);
    expect(storeSlice).toEqual(readSlice(db, "a1", FULL));
  });

  it("writes one lifecycle row without rewriting tenant siblings", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    db.exec(
      `CREATE TEMP TABLE lifecycle_writes (operation TEXT NOT NULL, tableName TEXT NOT NULL, rowId TEXT NOT NULL)`,
    );
    for (const table of SCOPED_KEYS) {
      db.exec(`
        CREATE TEMP TRIGGER lifecycle_${table}_insert AFTER INSERT ON ${table}
        BEGIN INSERT INTO lifecycle_writes VALUES ('insert', '${table}', NEW.id); END;
        CREATE TEMP TRIGGER lifecycle_${table}_update AFTER UPDATE ON ${table}
        BEGIN INSERT INTO lifecycle_writes VALUES ('update', '${table}', NEW.id); END;
        CREATE TEMP TRIGGER lifecycle_${table}_delete AFTER DELETE ON ${table}
        BEGIN INSERT INTO lifecycle_writes VALUES ('delete', '${table}', OLD.id); END;
      `);
    }
    const store = sqliteTenantStore(db);
    const row = store.readLifecycleRow("a1", "resources", "r1");
    expect(row).toBeDefined();

    store.writeLifecycleRow("a1", "resources", {
      ...(row as AppData["resources"][number]),
      archivedAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(db.prepare(`SELECT operation, tableName, rowId FROM lifecycle_writes`).all()).toEqual([
      { operation: "update", tableName: "resources", rowId: "r1" },
    ]);
    expect(store.readSlice("a2", FULL)).toEqual(readSlice(db, "a2", FULL));
  });

  it("write(id, slice) replaces ONLY that account; the other account is untouched", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const store = sqliteTenantStore(db);

    // Replace a1's slice with a single new allocation (drop everything else of a1's).
    const next = emptyAppData() as unknown as Record<string, unknown[]>;
    next.accounts = [account("a1")];
    next.clients = [client("c1", "a1")];
    next.disciplines = [discipline("d1", "a1")];
    next.projects = [project("p1", "a1", "c1")];
    next.resources = [person("r1", "a1", "d1")];
    next.activities = [activity("act1", "a1", "p1")];
    next.allocations = [allocation("al1b", "a1", "r1", "act1")]; // a NEW allocation id; old al1 must be gone
    store.write("a1", validatedCompleteAccountSlice(next as unknown as AppData));

    const a1 = store.readSlice("a1", FULL);
    expect(a1.allocations.map((r) => r.id)).toEqual(["al1b"]); // a1's scoped rows were REPLACED
    expect(a1.phases).toEqual([]); // dropped phase ph1

    // a2 is fully intact — write touched ONLY a1's scoped rows.
    const a2 = store.readSlice("a2", FULL);
    expect(a2.accounts.map((a) => a.id)).toEqual(["a2"]);
    for (const key of SCOPED_KEYS) {
      expect(a2[key].length).toBe(1);
      expect((a2[key][0] as { accountId: string }).accountId).toBe("a2");
    }
    // The global accounts row for a2 still loads from the whole tree.
    expect(
      loadState(db)
        .accounts.map((a) => a.id)
        .sort(),
    ).toEqual(["a1", "a2"]);
  });

  it("transact reads and replaces the complete slice inside one synchronous transaction", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const store = sqliteTenantStore(db);
    const otherTenantBefore = store.readSlice("a2", FULL);

    const result = store.transact("a1", FULL, (current) => {
      expect(db.isTransaction).toBe(true);
      return {
        next: {
          ...current,
          allocations: current.allocations.map((row) => ({
            ...row,
            note: "Atomic update",
          })),
        },
        result: "committed",
      };
    });

    expect(result).toBe("committed");
    expect(store.readSlice("a1", FULL).allocations[0]?.note).toBe("Atomic update");
    expect(store.readSlice("a2", FULL)).toEqual(otherTenantBefore);
  });

  it("transact rolls a destructive replacement back when reinsertion fails", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const store = sqliteTenantStore(db);
    const before = store.readSlice("a1", FULL);

    expect(() =>
      store.transact("a1", FULL, (current) => ({
        next: {
          ...current,
          allocations: current.allocations.map((row) => ({
            ...row,
            resourceId: "missing-resource",
          })),
        },
        result: undefined,
      })),
    ).toThrow();

    expect(store.readSlice("a1", FULL)).toEqual(before);
  });

  it("serves indexed mutation-validation lookups without crossing tenant boundaries", () => {
    const db = openDb(":memory:");
    insertAll(db, seedTwoAccounts());
    const lookup = sqliteTenantStore(db).validationLookup?.();

    expect(lookup?.row("resources", "r1")).toMatchObject({ id: "r1", accountId: "a1" });
    expect(lookup?.allocationsForResource("a1", "r1").map((row) => row.id)).toEqual(["al1"]);
    expect(lookup?.allocationsForActivity("a1", "act1").map((row) => row.id)).toEqual(["al1"]);
    expect(lookup?.allocationsForResource("a1", "r2")).toEqual([]);
    expect(lookup?.resourceHasLoadedAllocation("a1", "r1")).toBe(true);
    expect(lookup?.resourceHasTimeOff("a1", "r1")).toBe(true);

    db.prepare(`UPDATE allocations SET hoursPerDay = 0 WHERE id = ?`).run("al1");
    expect(lookup?.resourceHasLoadedAllocation("a1", "r1")).toBe(false);
    expect(lookup?.resourceHasLoadedAllocation("a2", "r2")).toBe(true);
  });

  it("scrubs resource notes, advances revisions and preserves another tenant", () => {
    const db = openDb(":memory:");
    const data = seedTwoAccounts() as unknown as Record<string, unknown[]>;
    data.timeOff = [timeOff("to1", "a1", "r1", "private-a1"), timeOff("to2", "a2", "r2", "private-a2")];
    insertAll(db, data as unknown as AppData);
    const store = sqliteTenantStore(db);

    expect(store.scrubResourceNotes("a1", "r1")).toEqual({ allocationNotes: true, timeOffNotes: true });
    const a1 = store.readSlice("a1", FULL);
    expect(a1.allocations[0]).not.toHaveProperty("note");
    expect(a1.timeOff[0]).not.toHaveProperty("note");
    expect(Date.parse(a1.allocations[0].updatedAt)).toBeGreaterThan(Date.parse(TS));
    expect(Date.parse(a1.timeOff[0].updatedAt)).toBeGreaterThan(Date.parse(TS));
    expect(store.readSlice("a2", FULL).allocations[0]?.note).toBe("hi");
    expect(store.readSlice("a2", FULL).timeOff[0]?.note).toBe("private-a2");
  });

  it.each([
    ["projects", "p1", { projects: 1, phases: 1, activities: 1, allocations: 1 }],
    ["clients", "c1", { clients: 1, projects: 1, phases: 1, activities: 1, allocations: 1 }],
  ] as const)("purges one owned %s row with exact cascades and restamped nullable survivors", (entity, id, counts) => {
    const db = openDb(":memory:");
    const data = seedTwoAccounts() as unknown as Record<string, unknown[]>;
    data.resources = [{ ...person("r1", "a1", "d1"), projectId: "p1" }, person("r2", "a2", "d2")];
    insertAll(db, data as unknown as AppData);
    const store = sqliteTenantStore(db);

    expect(store.purgeLifecycleRow("a1", entity, id)).toEqual({ removedCounts: counts });
    const survivor = store.readLifecycleRow("a1", "resources", "r1");
    expect(survivor).not.toHaveProperty("projectId");
    expect(Date.parse(survivor?.updatedAt ?? "")).toBeGreaterThan(Date.parse(TS));
    expect(store.readSlice("a2", FULL)).toEqual(readSlice(db, "a2", FULL));
    expect(store.purgeLifecycleRow("a1", entity, id)).toBeNull();
  });
});

describe("readSlice — P1.6 time-off note redaction", () => {
  // Seed a1 with a time-off row carrying a note; the standalone primitive decides note visibility
  // from the REQUIRED includeTimeOffNote flag (the route maps it to canSeeTimeOffNote(role)).
  const NOTE = "PRIVATE_TIMEOFF_NOTE";
  function seedWithNote(): Db {
    const db = openDb(":memory:");
    const d = seedTwoAccounts() as unknown as Record<string, unknown[]>;
    d.timeOff = [timeOff("to1", "a1", "r1", NOTE)];
    insertAll(db, d as unknown as AppData);
    return db;
  }

  it("includeTimeOffNote:true keeps the note", () => {
    const slice = readSlice(seedWithNote(), "a1", {
      includeTimeOffNote: true,
      includeInactive: true,
      includePrivateNames: true,
    });
    expect((slice.timeOff[0] as { note?: string }).note).toBe(NOTE);
  });

  it("includeTimeOffNote:false STRIPS the note key (absent, not null)", () => {
    const slice = readSlice(seedWithNote(), "a1", {
      includeTimeOffNote: false,
      includeInactive: true,
      includePrivateNames: true,
    });
    expect("note" in slice.timeOff[0]).toBe(false);
    expect((slice.timeOff[0] as { note?: string }).note).toBeUndefined();
  });
});

describe("readSlice — private client/project name redaction", () => {
  function seedPrivateNames(): Db {
    const db = openDb(":memory:");
    const d = seedTwoAccounts() as unknown as Record<string, unknown[]>;
    d.clients = [
      {
        ...client("c1", "a1"),
        name: "Real Client",
        isPrivate: true,
        codeName: "Nightwing",
      },
      client("c2", "a2"),
    ];
    d.projects = [
      {
        ...project("p1", "a1", "c1"),
        name: "Real Project",
        isPrivate: true,
        codeName: "Aurora",
      },
      project("p2", "a2", "c2"),
    ];
    insertAll(db, d as unknown as AppData);
    return db;
  }

  it("includePrivateNames:true preserves owner-visible stored fields", () => {
    const slice = readSlice(seedPrivateNames(), "a1", FULL);
    expect(slice.clients[0]).toMatchObject({
      name: "Real Client",
      isPrivate: true,
      codeName: "Nightwing",
    });
    expect(slice.projects[0]).toMatchObject({
      name: "Real Project",
      isPrivate: true,
      codeName: "Aurora",
    });
  });

  it("includePrivateNames:false replaces both real names with quoted code names", () => {
    const slice = readSlice(seedPrivateNames(), "a1", {
      ...FULL,
      includePrivateNames: false,
    });
    expect(slice.clients[0]).toMatchObject({
      name: '"Nightwing"',
      isPrivate: true,
    });
    expect(slice.projects[0]).toMatchObject({
      name: '"Aurora"',
      isPrivate: true,
    });
    expect(slice.clients[0]).not.toHaveProperty("codeName");
    expect(slice.projects[0]).not.toHaveProperty("codeName");
  });
});

describe("readSlice — P2.4 lifecycle projection (includeInactive)", () => {
  const ARCH = "2026-03-01T00:00:00.000Z";
  const DEL = "2026-04-01T00:00:00.000Z";

  // One account 'a1' with a MIX in each lifecycle-bearing table: an active + an archived resource,
  // an active + a soft-deleted client, an active + a soft-deleted project. Plus a phase, an activity
  // and a time-off row (no lifecycle field) to prove they pass through regardless of the flag.
  function seedLifecycleMix(): Db {
    const db = openDb(":memory:");
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.disciplines = [discipline("d1", "a1")];
    d.clients = [
      client("c-active", "a1"),
      { ...client("c-deleted", "a1"), archivedAt: ARCH, deletedAt: DEL }, // soft-deleted
    ];
    d.projects = [
      project("p-active", "a1", "c-active"),
      {
        ...project("p-deleted", "a1", "c-active"),
        archivedAt: ARCH,
        deletedAt: DEL,
      }, // soft-deleted
    ];
    d.resources = [
      person("r-active", "a1", "d1"),
      { ...person("r-archived", "a1", "d1"), archivedAt: ARCH }, // archived (not deleted)
    ];
    // Non-lifecycle children — must survive BOTH flags untouched.
    d.phases = [phase("ph1", "a1", "p-active")];
    d.activities = [activity("act1", "a1", "p-active")];
    d.timeOff = [timeOff("to1", "a1", "r-active")];
    insertAll(db, d as unknown as AppData);
    return db;
  }

  it("includeInactive:false returns ONLY the active resource/client/project rows", () => {
    const slice = readSlice(seedLifecycleMix(), "a1", {
      includeTimeOffNote: true,
      includeInactive: false,
      includePrivateNames: true,
    });
    expect(slice.resources.map((r) => r.id)).toEqual(["r-active"]);
    expect(slice.clients.map((c) => c.id)).toEqual(["c-active"]);
    expect(slice.projects.map((p) => p.id)).toEqual(["p-active"]);
    // Non-lifecycle tables are NEVER filtered — pass through unchanged.
    expect(slice.phases.map((p) => p.id)).toEqual(["ph1"]);
    expect(slice.activities.map((a) => a.id)).toEqual(["act1"]);
    expect(slice.timeOff.map((t) => t.id)).toEqual(["to1"]);
  });

  it("includeInactive:true returns ALL rows (active + archived + soft-deleted)", () => {
    const slice = readSlice(seedLifecycleMix(), "a1", {
      includeTimeOffNote: true,
      includeInactive: true,
      includePrivateNames: true,
    });
    expect(slice.resources.map((r) => r.id).sort()).toEqual(["r-active", "r-archived"]);
    expect(slice.clients.map((c) => c.id).sort()).toEqual(["c-active", "c-deleted"]);
    expect(slice.projects.map((p) => p.id).sort()).toEqual(["p-active", "p-deleted"]);
    // Children unaffected by the flag.
    expect(slice.phases.map((p) => p.id)).toEqual(["ph1"]);
    expect(slice.activities.map((a) => a.id)).toEqual(["act1"]);
    expect(slice.timeOff.map((t) => t.id)).toEqual(["to1"]);
  });

  it("the rows remain in the DB (retained) — the WHOLE-tree loadState still sees every row", () => {
    const db = seedLifecycleMix();
    // The projection narrows the READ only; nothing is deleted. loadState (export/OFF whole read) keeps all.
    const all = loadState(db);
    expect(all.resources.filter((r) => r.accountId === "a1").length).toBe(2);
    expect(all.clients.filter((c) => c.accountId === "a1").length).toBe(2);
    expect(all.projects.filter((p) => p.accountId === "a1").length).toBe(2);
  });
});
