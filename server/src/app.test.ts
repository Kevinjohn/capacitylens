import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp, statusFor, MAX_BATCH_OPS, type AppOptions } from "./app";
import { ValidationError } from "./validate";
import { getRow, insertRow, openDb, upsertRow, type Db } from "./db";
import { tx } from "./txn";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_CLIENT,
  FIXTURE_DISCIPLINE,
  FIXTURE_PROJECT,
  FIXTURE_PHASE,
  FIXTURE_RESOURCE,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_ACTIVITY,
  FIXTURE_ACTIVITY_INTERNAL,
  FIXTURE_ACTIVITY_REPEATABLE,
  FIXTURE_ALLOCATION,
  FIXTURE_TIMEOFF,
} from "@capacitylens/shared/data/fixtures";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { runImportWorker } from "./runImportWorker";
import type { AuditEntry } from "./audit";
import { WorkQueueFullError } from "./workQueue";

// API integration tests: drive the real Fastify app + a real (in-memory) node:sqlite
// DB via inject(). Covers CRUD, whole-state read, cascade deletes, import round-trip,
// migration reuse, and the validation rules — which run the SAME shared domain-core
// the client uses, so passing here proves "server validation == client validation".

const TS = "2026-01-01T00:00:00.000Z";
const MAX_BATCH_HANDLER_BUDGET_MS = 4_000;
const meta = () => ({ createdAt: TS, updatedAt: TS });
const withoutRevision = <T extends object>(row: T) => {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function freshApp(allowReset = true, extra: Partial<AppOptions> = {}) {
  const db = openDb(":memory:");
  return {
    app: buildApp(db, { allowReset, optimisticConcurrency: false, ...extra }),
    db,
  };
}

const FULL_APP_TABLE_SELECT =
  /^\s*SELECT \* FROM (accounts|disciplines|resources|clients|projects|phases|activities|allocations|timeOff)\s*$/;

function dbTrackingFullTableSelects(): {
  db: Db;
  raw: Db;
  fullTableSelects: string[];
} {
  const raw = openDb(":memory:");
  const fullTableSelects: string[] = [];
  const db = new Proxy(raw, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          if (FULL_APP_TABLE_SELECT.test(sql)) fullTableSelects.push(sql);
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Db;
  return { db, raw, fullTableSelects };
}

const account = (id: string) => ({
  id,
  name: "Studio",
  color: "#5c34d4",
  ...meta(),
});
const client = (id: string, accountId: string) => ({
  id,
  accountId,
  name: "Acme",
  color: "#5c34d4",
  ...meta(),
});
const project = (id: string, accountId: string, clientId: string) => ({
  id,
  accountId,
  name: "Web",
  clientId,
  color: "#5c34d4",
  ...meta(),
});
const activity = (id: string, accountId: string, projectId: string, phaseId?: string) => ({
  id,
  accountId,
  name: "Activity",
  kind: "project",
  projectId,
  phaseId,
  ...meta(),
});
const person = (id: string, accountId: string) => ({
  id,
  accountId,
  kind: "person",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#5c34d4",
  ...meta(),
});
const placeholder = (id: string, accountId: string, projectId?: string) => ({
  ...person(id, accountId),
  kind: "placeholder",
  projectId,
});
const allocation = (
  id: string,
  accountId: string,
  resourceId: string,
  activityId: string,
  o: Record<string, unknown> = {},
) =>
  // Object.assign (rather than `{ ...base, ...o }`) so overriding well-known keys via
  // `o` doesn't trip TS2783 on the literal's explicit startDate/endDate/etc.
  Object.assign(
    {
      id,
      accountId,
      resourceId,
      activityId,
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed",
      ...meta(),
    },
    o,
  );

// app.inject's overloads resolve to a union that hides statusCode/json; this wrapper
// pins the single Promise-returning shape so call sites stay terse.
const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>;
const body = (payload: unknown) => payload as InjectOptions["payload"];

const post = (app: FastifyInstance, entity: string, payload: unknown) =>
  call(app, { method: "POST", url: `/api/${entity}`, payload: body(payload) });
const put = (app: FastifyInstance, entity: string, id: string, payload: unknown) =>
  call(app, {
    method: "PUT",
    url: `/api/${entity}/${id}`,
    payload: body(payload),
  });
const patch = (app: FastifyInstance, entity: string, id: string, payload: unknown) =>
  call(app, {
    method: "PATCH",
    url: `/api/${entity}/${id}`,
    payload: body(payload),
  });
// Scoped tables now REQUIRE an asserted owning account on DELETE; pass accountId for them.
// accounts (top-level) carry none, so accountId is omitted there.
const del = (app: FastifyInstance, entity: string, id: string, accountId?: string) =>
  call(app, {
    method: "DELETE",
    url: accountId ? `/api/${entity}/${id}?accountId=${accountId}` : `/api/${entity}/${id}`,
  });
const batch = (app: FastifyInstance, ops: unknown[]) =>
  call(app, { method: "POST", url: "/api/batch", payload: body({ ops }) });
const orderedBatch = (app: FastifyInstance, sessionId: string, sequence: number, ops: unknown[]) =>
  call(app, {
    method: "POST",
    url: "/api/batch",
    headers: {
      "x-capacitylens-sync-session": sessionId,
      "x-capacitylens-sync-sequence": String(sequence),
    },
    payload: body({ ops }),
  });
const state = async (app: FastifyInstance) => {
  const data = (await call(app, { method: "GET", url: "/api/state" })).json();
  // Generic account creation now guarantees its required Internal client. Most legacy CRUD tests
  // predate that invariant and reason about the regular clients they explicitly create.
  data.clients = data.clients.filter((c: { id: string }) => !c.id.startsWith("internal:"));
  return data;
};

/** Seed a minimal account → client → project → activity → person chain. */
async function scaffold(app: FastifyInstance) {
  await post(app, "accounts", account("a1"));
  await post(app, "clients", client("c1", "a1"));
  await post(app, "projects", project("p1", "a1", "c1"));
  await post(app, "activities", activity("t1", "a1", "p1"));
  await post(app, "resources", person("r1", "a1"));
}

describe("health + state", () => {
  it("reports health and starts empty", async () => {
    const { app } = freshApp();
    expect((await call(app, { method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
    const s = await state(app);
    expect(s.accounts).toEqual([]);
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: false });
  });
});

describe("request/connection timeouts (slowloris guard for the direct-exposure deploy)", () => {
  it("bounds both requestTimeout and connectionTimeout — Fastify defaults both to 0 (disabled)", () => {
    const { app } = freshApp();
    // initialConfig's TS typing omits requestTimeout (a Fastify 5 typings gap — it's present at
    // runtime, ajv-defaulted like every other init option), so assert against the raw Node server
    // Fastify actually configures: requestTimeout is a direct assignment, connectionTimeout is
    // applied via server.setTimeout() (which Node mirrors onto the `timeout` property).
    expect(app.initialConfig.connectionTimeout).toBe(30_000);
    expect(app.server.requestTimeout).toBe(30_000);
    expect(app.server.timeout).toBe(30_000);
  });
});

describe("CRUD round-trip", () => {
  it("creates every entity type and reads them back via /api/state", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect((await post(app, "allocations", allocation("al1", "a1", "r1", "t1"))).statusCode).toBe(201);
    const s = await state(app);
    expect(s.accounts).toHaveLength(1);
    expect(s.clients).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
    expect(s.activities).toHaveLength(1);
    expect(s.resources).toHaveLength(1);
    expect(s.allocations).toHaveLength(1);
    // Round-trips exactly: both weekday JSON arrays + omitted optionals survive.
    expect(withoutRevision(s.resources[0])).toEqual(
      withoutRevision({
        ...person("r1", "a1"),
        name: "Unnamed person",
      }),
    );
    expect(withoutRevision(s.allocations[0])).toEqual(withoutRevision(allocation("al1", "a1", "r1", "t1")));
  });

  it("persists an explicit mixed full and half-day resource pattern", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const response = await post(app, "resources", { ...person("r1", "a1"), halfDays: [2, 4] });

    expect(response.statusCode).toBe(201);
    expect((await state(app)).resources[0]).toMatchObject({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [2, 4],
    });
  });

  it("PATCH updates fields; DELETE removes a non-lifecycle row", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await patch(app, "clients", "c1", {
      ...client("c1", "a1"),
      name: "Renamed",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed");
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      color: "#5c34d4",
      sortOrder: 0,
      ...meta(),
    });
    expect((await del(app, "disciplines", "d1", "a1")).statusCode).toBe(204);
    expect((await state(app)).disciplines).toHaveLength(0);
  });

  it("PATCH on a missing id is 404; unknown entity is 404", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect((await patch(app, "clients", "nope", client("nope", "a1"))).statusCode).toBe(404);
    expect((await post(app, "widgets", { id: "x" })).statusCode).toBe(404);
  });

  it("PATCH is a partial merge: omitted fields keep their stored value", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A real partial patch — only `role`. kind/employmentType/workingDays/etc. must
    // survive (a blind column-wise UPDATE would null the NOT NULL columns → 500/400).
    const res = await patch(app, "resources", "r1", { role: "Lead Designer" });
    expect(res.statusCode).toBe(200);
    const s = await state(app);
    const r = s.resources[0];
    expect(r.role).toBe("Lead Designer");
    expect(r.kind).toBe("person");
    expect(r.employmentType).toBe("permanent");
    expect(r.workingHoursPerDay).toBe(8);
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.color).toBe("#5c34d4");
  });

  it("PATCH persists and clears a resource favourite", async () => {
    const { app, db } = freshApp();
    await scaffold(app);

    expect((await patch(app, "resources", "r1", { isFavourite: true })).json().isFavourite).toBe(true);
    expect(getRow(db, "resources", "r1")?.isFavourite).toBe(true);

    expect((await patch(app, "resources", "r1", { isFavourite: false })).json().isFavourite).toBe(false);
    expect(getRow(db, "resources", "r1")?.isFavourite).toBe(false);
  });

  it("refuses to re-home an existing row to another account (accountId is immutable)", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 in a1
    await post(app, "accounts", account("a2"));
    // PATCH and PUT that try to move c1 into a2 are indistinguishable from an absent row.
    expect((await patch(app, "clients", "c1", { accountId: "a2" })).statusCode).toBe(404);
    expect((await put(app, "clients", "c1", { ...client("c1", "a2") })).statusCode).toBe(404);
    // …and c1 stays in a1.
    expect((await state(app)).clients[0].accountId).toBe("a1");
  });

  it("scopes a non-lifecycle delete to its owning account", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 belongs to a1
    await post(app, "accounts", account("a2"));
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      color: "#5c34d4",
      sortOrder: 0,
      ...meta(),
    });
    // Asserting the WRONG account refuses with 404 and leaves the row in place…
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: "/api/disciplines/d1?accountId=a2",
        })
      ).statusCode,
    ).toBe(404);
    expect((await state(app)).disciplines).toHaveLength(1);
    // …the correct owner deletes it.
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: "/api/disciplines/d1?accountId=a1",
        })
      ).statusCode,
    ).toBe(204);
    expect((await state(app)).disciplines).toHaveLength(0);
  });

  it("refuses a scoped delete that omits accountId (the by-id bypass is closed → 400)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A scoped delete MUST assert its owner; omitting accountId can't prove ownership, so
    // it is a 400 rather than an unscoped delete-by-id (the old tenant-guard bypass).
    expect((await call(app, { method: "DELETE", url: "/api/clients/c1" })).statusCode).toBe(400);
    expect((await state(app)).clients).toHaveLength(1); // not deleted
  });

  it("preserves the immutable createdAt on update (a PUT cannot rewrite it)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const original = (await state(app)).clients[0].createdAt;
    await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      name: "Renamed",
      createdAt: "2099-01-01T00:00:00.000Z",
    });
    const after = (await state(app)).clients[0];
    expect(after.name).toBe("Renamed"); // everything else updates
    expect(after.createdAt).toBe(original); // …but createdAt is preserved
  });

  it("reports hasData:true after the user deletes all their data (no demo re-seed)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: true });
    await del(app, "accounts", "a1"); // user empties everything
    expect((await state(app)).accounts).toHaveLength(0);
    // Still "initialised" — a reload must NOT mistake an emptied dataset for a fresh one.
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: true });
  });

  it("DELETE is idempotent for non-lifecycle tables (missing id still 204 when the owner is asserted)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await del(app, "phases", "ghost", "a1")).statusCode).toBe(204);
  });

  it("PUT upserts idempotently: first call creates, second overwrites (no conflict)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const c = client("c1", "a1");
    expect((await put(app, "clients", "c1", c)).statusCode).toBe(200);
    // Replay the SAME create — must not error (the sync adapter relies on this when
    // replaying a batch after a partial failure).
    const replay = await put(app, "clients", "c1", c);
    expect(replay.statusCode).toBe(200);
    // A changed body overwrites.
    expect(
      (
        await put(app, "clients", "c1", {
          ...c,
          updatedAt: replay.json().updatedAt,
          name: "Renamed",
        })
      ).statusCode,
    ).toBe(200);
    const s = await state(app);
    expect(s.clients).toHaveLength(1);
    expect(s.clients[0].name).toBe("Renamed");
  });

  it("PUT rejects a body id that disagrees with the URL id", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await put(app, "clients", "c1", client("OTHER", "a1"))).statusCode).toBe(400);
  });

  it("PUT runs shared-core validation (rejects a dangling FK)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await put(app, "projects", "p1", project("p1", "a1", "no-client"))).statusCode).toBe(400);
  });
});

describe("generic lifecycle deletion guard", () => {
  it("rejects deleting a client and leaves its full subtree intact", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "allocations", allocation("al1", "a1", "r1", "t1"));
    expect((await del(app, "clients", "c1", "a1")).statusCode).toBe(400);
    const s = await state(app);
    expect(s.clients).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
    expect(s.activities).toHaveLength(1);
    expect(s.allocations).toHaveLength(1);
    expect(s.resources).toHaveLength(1);
  });

  it("deleting a discipline ungroups resources (SET NULL, not delete)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      sortOrder: 0,
      ...meta(),
    });
    await post(app, "resources", { ...person("r1", "a1"), disciplineId: "d1" });
    await del(app, "disciplines", "d1", "a1");
    const s = await state(app);
    expect(s.disciplines).toHaveLength(0);
    expect(s.resources).toHaveLength(1);
    expect(s.resources[0].disciplineId).toBeUndefined();
  });
});

describe("batch sync (/api/batch — transactional, ordered)", () => {
  it("rejects a lifecycle DELETE before executing any batch operation", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "clients", client("c1", "a1"));
    await post(app, "clients", client("c2", "a1"));
    await post(app, "projects", project("p1", "a1", "c1")); // p1 under c1
    await post(app, "activities", activity("t1", "a1", "p1"));
    // The forbidden lifecycle DELETE rejects the whole request before the preceding reparent runs.
    const res = await batch(app, [
      {
        method: "PUT",
        table: "projects",
        id: "p1",
        row: {
          ...project("p1", "a1", "c2"),
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
      { method: "DELETE", table: "clients", id: "c1", accountId: "a1" },
    ]);
    expect(res.statusCode).toBe(400);
    const s = await state(app);
    expect(s.clients.map((c: { id: string }) => c.id)).toEqual(["c1", "c2"]);
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0].clientId).toBe("c1");
    expect(s.activities).toHaveLength(1);
  });

  it("rolls the WHOLE batch back if any op fails (atomic)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // First op valid (new client c3); second references a missing client → validation 400.
    const res = await batch(app, [
      { method: "PUT", table: "clients", id: "c3", row: client("c3", "a1") },
      {
        method: "PUT",
        table: "projects",
        id: "bad",
        row: project("bad", "a1", "ghost-client"),
      },
    ]);
    expect(res.statusCode).toBe(400);
    const s = await state(app);
    expect(s.clients).toHaveLength(0); // c3 rolled back with the bad op — nothing persisted
    expect(s.projects).toHaveLength(0);
  });

  it("rolls back valid repeated allocations when one generated sibling is invalid", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await batch(app, [
      { method: "PUT", table: "allocations", id: "repeat-good", row: allocation("repeat-good", "a1", "r1", "t1") },
      { method: "PUT", table: "allocations", id: "repeat-bad", row: allocation("repeat-bad", "a1", "missing", "t1") },
    ]);
    expect(res.statusCode).toBe(400);
    expect((await state(app)).allocations).toHaveLength(0);
  });

  it("rolls back earlier operations when a placeholder rebind would invalidate existing work", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "resources", placeholder("ph", "a1", "p1"));
    await post(app, "allocations", allocation("al", "a1", "ph", "t1"));

    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...client("c1", "a1"), name: "Must roll back" },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: placeholder("ph", "a1", "p2"),
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/placeholder’s work/i);
    const snapshot = await state(app);
    expect(snapshot.clients[0].name).toBe("Acme");
    expect(snapshot.resources.find((resource: { id: string }) => resource.id === "ph").projectId).toBe("p1");
  });

  it("refuses a cross-account delete inside a batch and rolls back", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 in a1
    await post(app, "accounts", account("a2"));
    const res = await batch(app, [{ method: "DELETE", table: "clients", id: "c1", accountId: "a2" }]);
    expect(res.statusCode).toBe(400);
    expect((await state(app)).clients).toHaveLength(1); // c1 untouched
  });

  it("rejects a scoped delete op that omits accountId", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await batch(app, [{ method: "DELETE", table: "clients", id: "c1" }]);
    expect(res.statusCode).toBe(400);
    expect((await state(app)).clients).toHaveLength(1);
  });

  it("rejects an unknown table / bad op shape", async () => {
    const { app } = freshApp();
    expect((await batch(app, [{ method: "PUT", table: "widgets", id: "x", row: { id: "x" } }])).statusCode).toBe(400);
    expect((await batch(app, [{ method: "PUT", table: "clients", id: "c1", row: { id: "OTHER" } }])).statusCode).toBe(
      400,
    );
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/batch",
          payload: body({ nope: true }),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects a null operation as a validation error instead of throwing a 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: body({ ops: [null] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/object/i);
  });
});

describe("validation (shared domain-core) rejects bad writes with 400", () => {
  it("rejects direct writes that omit values only the import path may repair", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await post(app, "resources", {
      id: "r1",
      accountId: "a1",
      name: "Ada",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/missing required field.*kind/i);
    expect((await state(app)).resources).toEqual([]);
  });

  it("rejects missing required project and phase parents at the shared boundary", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "clients", client("c1", "a1"));

    const missingClient = await post(app, "projects", {
      id: "p1",
      accountId: "a1",
      name: "Project",
      color: "#5c34d4",
      ...meta(),
    });
    expect(missingClient.statusCode).toBe(400);
    expect(missingClient.json().error).toBe("Project must reference a client in this company.");
    expect(missingClient.json().code).toBe("reference_wrong_account");

    await post(app, "projects", project("p2", "a1", "c1"));
    const missingClientOnReplace = await put(app, "projects", "p2", {
      id: "p2",
      accountId: "a1",
      name: "Replacement",
      color: "#5c34d4",
      ...meta(),
    });
    expect(missingClientOnReplace.statusCode).toBe(400);
    expect(missingClientOnReplace.json().error).toBe("Project must reference a client in this company.");
    expect((await patch(app, "projects", "p2", { name: "Partial rename" })).statusCode).toBe(200);

    const missingProject = await post(app, "phases", {
      id: "ph1",
      accountId: "a1",
      name: "Phase",
      ...meta(),
    });
    expect(missingProject.statusCode).toBe(400);
    expect(missingProject.json().error).toBe("Phase must reference a project in this company.");
  });

  it("rejects a project referencing a client outside the account", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await post(app, "projects", project("p1", "a1", "no-such-client"));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/client/i);
  });

  it("rejects a reversed allocation date range", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await post(
      app,
      "allocations",
      allocation("bad", "a1", "r1", "t1", {
        startDate: "2026-02-10",
        endDate: "2026-02-01",
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/end date/i);
  });

  it("accepts the maximum scheduling span and rejects longer allocation and time-off writes", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const startDate = "2026-01-01";
    const atLimit = addDaysISO(startDate, MAX_SPAN_DAYS - 1);
    const overLimit = addDaysISO(startDate, MAX_SPAN_DAYS);

    expect(
      (
        await post(
          app,
          "allocations",
          allocation("at-limit", "a1", "r1", "t1", {
            startDate,
            endDate: atLimit,
          }),
        )
      ).statusCode,
    ).toBe(201);

    const allocationResponse = await post(
      app,
      "allocations",
      allocation("over-limit", "a1", "r1", "t1", {
        startDate,
        endDate: overLimit,
      }),
    );
    expect(allocationResponse.statusCode).toBe(400);
    expect(allocationResponse.json().error).toBe("Date span cannot exceed 36,500 calendar days.");

    const timeOffResponse = await post(app, "timeOff", {
      id: "to-over-limit",
      accountId: "a1",
      resourceId: "r1",
      startDate,
      endDate: overLimit,
      type: "holiday",
      ...meta(),
    });
    expect(timeOffResponse.statusCode).toBe(400);
    expect(timeOffResponse.json().error).toBe("Date span cannot exceed 36,500 calendar days.");
  });

  it("rejects a placeholder assigned outside its bound project", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "activities", activity("t2", "a1", "p2"));
    await post(app, "resources", placeholder("ph", "a1", "p1")); // bound to p1
    const res = await post(app, "allocations", allocation("al", "a1", "ph", "t2")); // t2 is in p2
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/placeholder/i);
  });

  it("rejects parent edits that would invalidate an existing placeholder allocation", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "resources", placeholder("ph", "a1", "p1"));
    await post(app, "allocations", allocation("al", "a1", "ph", "t1"));

    const rebind = await patch(app, "resources", "ph", { projectId: "p2" });
    expect(rebind.statusCode).toBe(400);
    expect(rebind.json().error).toMatch(/placeholder’s work/i);

    const reproject = await patch(app, "activities", "t1", { projectId: "p2" });
    expect(reproject.statusCode).toBe(400);
    expect(reproject.json().error).toMatch(/placeholder work/i);

    const snapshot = await state(app);
    expect(snapshot.resources.find((resource: { id: string }) => resource.id === "ph").projectId).toBe("p1");
    expect(snapshot.activities.find((activityRow: { id: string }) => activityRow.id === "t1").projectId).toBe("p1");
  });

  it("rejects an allocation referencing a missing resource/activity", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await post(app, "allocations", allocation("al", "a1", "ghost", "t1"));
    expect(res.statusCode).toBe(400);
  });

  it("fails closed when a corrupt project-bound activity points at another account's project", async () => {
    const { app, db } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    await post(app, "clients", client("c2", "a2"));
    await post(app, "projects", project("p2", "a2", "c2"));
    await post(app, "resources", person("r1", "a1"));

    // The ordinary activity route and current database trigger reject this mismatch. Remove that
    // one insert trigger to model post-start operator tampering and prove the allocation write
    // boundary independently re-checks the project tenant.
    db.exec("DROP TRIGGER capacitylens_tenant_activities_projectId_insert");
    insertRow(db, "activities", activity("cross-project", "a1", "p2"));

    const res = await post(app, "allocations", allocation("al", "a1", "r1", "cross-project"));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Allocation must reference an activity under an active project in this company.");
  });

  it("rejects a non-zero allocation load on an external / 3rd-party resource (no capacity)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(app, "allocations", allocation("al", "a1", "ext", "t1", { hoursPerDay: 8 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/external/i);
  });

  it("accepts a zero-load allocation on an external resource (the form forces 0)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(app, "allocations", allocation("al", "a1", "ext", "t1", { hoursPerDay: 0 }));
    expect(res.statusCode).toBe(201);
  });

  it("rejects time off on an external / 3rd-party resource (no capacity)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(app, "timeOff", {
      id: "to1",
      accountId: "a1",
      resourceId: "ext",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      type: "holiday",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/external/i);
  });

  // Flipping a resource to external while it still owns loaded work / time-off would orphan those
  // dependents (the scheduler hides external capacity + time-off). The server rejects the flip on
  // BOTH the full-row PUT and the partial PATCH merge — same shared assert as the store.
  it("rejects PATCH setting kind:external on a resource that has a loaded allocation", async () => {
    const { app } = freshApp();
    await scaffold(app); // r1 is a person
    await post(app, "allocations", allocation("al", "a1", "r1", "t1", { hoursPerDay: 8 }));
    const res = await patch(app, "resources", "r1", { kind: "external" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/work and time off/i);
  });

  it("rejects PUT setting kind:external on a resource that has time off", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "timeOff", {
      id: "to1",
      accountId: "a1",
      resourceId: "r1",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      type: "holiday",
      ...meta(),
    });
    const res = await put(app, "resources", "r1", {
      ...person("r1", "a1"),
      kind: "external",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/work and time off/i);
  });

  it("accepts flipping a resource to external when it has NO disallowed dependents (zero-load allocation is fine)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A zero-load allocation is already valid for an external, so it must NOT block the flip.
    await post(app, "allocations", allocation("al", "a1", "r1", "t1", { hoursPerDay: 0 }));
    expect((await patch(app, "resources", "r1", { kind: "external" })).statusCode).toBe(200);
    expect((await state(app)).resources.find((r: { id: string }) => r.id === "r1").kind).toBe("external");
  });

  it("accepts creating an external resource with no dependents, and editing its name", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect(
      (
        await post(app, "resources", {
          ...person("ext", "a1"),
          kind: "external",
        })
      ).statusCode,
    ).toBe(201);
    expect((await patch(app, "resources", "ext", { role: "Overflow" })).statusCode).toBe(200);
  });
});

describe("built-in Internal client is a per-account singleton on direct writes", () => {
  it("rejects replacing the generated Internal client id", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "projects", project("p-internal", "a1", "internal:a1"));
    await post(app, "activities", activity("t-internal", "a1", "p-internal"));
    await post(app, "resources", person("r1", "a1"));
    await post(app, "allocations", allocation("al1", "a1", "r1", "t-internal"));

    const replacement = await post(app, "clients", {
      ...client("legacy-internal", "a1"),
      builtin: true,
    });
    expect(replacement.statusCode).toBe(400);
    const snapshot = (await call(app, { method: "GET", url: "/api/state?accountId=a1" })).json();
    expect(snapshot.projects.find((p: { id: string }) => p.id === "p-internal")?.clientId).toBe("internal:a1");
    expect(snapshot.activities.some((a: { id: string }) => a.id === "t-internal")).toBe(true);
    expect(snapshot.allocations.some((a: { id: string }) => a.id === "al1")).toBe(true);
  });

  it("rejects every generic attempt to create a builtin client", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await post(app, "clients", { ...client("c-int", "a1"), builtin: true })).statusCode).toBe(400);
    const dup = await post(app, "clients", {
      ...client("c-int2", "a1"),
      builtin: true,
    });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error).toMatch(/built-in|Internal/i);
  });

  it("rejects generic updates to the generated builtin client", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await put(app, "clients", "internal:a1", {
      ...client("internal:a1", "a1"),
      name: "Renamed",
      builtin: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a counterfeit same-batch duplicate of a freshly generated Internal client", async () => {
    const { app } = freshApp();
    const res = await batch(app, [
      { method: "PUT", table: "accounts", id: "a1", row: account("a1") },
      {
        method: "PUT",
        table: "clients",
        id: "internal:a1",
        row: {
          ...client("internal:a1", "a1"),
          name: "Counterfeit built-in",
          color: "#ffffff",
          builtin: false,
        },
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/generated|built-in|Internal/i);
    expect((await state(app)).accounts).toEqual([]);
    expect((await state(app)).clients).toEqual([]);
  });

  it("accepts the canonical same-batch duplicate of a freshly generated Internal client", async () => {
    const auditEntries: AuditEntry[] = [];
    const { app } = freshApp(true, {
      audit: {
        append: (entry) => {
          auditEntries.push(entry);
          return true;
        },
        degraded: false,
      },
    });
    const res = await batch(app, [
      { method: "PUT", table: "accounts", id: "a1", row: account("a1") },
      {
        method: "PUT",
        table: "clients",
        id: "internal:a1",
        row: buildInternalClient("a1", TS),
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, applied: 2, changed: 1 });
    expect(
      auditEntries.filter((entry) => "entity" in entry).map(({ entity, action, id }) => ({ entity, action, id })),
    ).toEqual([{ entity: "accounts", action: "create", id: "a1" }]);
    const stored = (await call(app, { method: "GET", url: "/api/state" })).json();
    expect(stored.clients).toMatchObject([
      {
        id: "internal:a1",
        accountId: "a1",
        name: "Internal",
        builtin: true,
      },
    ]);
  });

  it("creates one protected builtin in each account", async () => {
    // multiAccount: true — this test deliberately creates a SECOND company on one instance, which
    // the default single-company cap would otherwise 403 (see app.singleCompanyCap.test.ts for the
    // cap's own coverage); this test is about per-account builtin scoping, not the cap.
    const { app } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    expect(
      (
        await post(app, "clients", {
          ...client("c-int-1", "a1"),
          builtin: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(app, "clients", {
          ...client("c-int-2", "a2"),
          builtin: true,
        })
      ).statusCode,
    ).toBe(400);
    const snapshot = (await call(app, { method: "GET", url: "/api/state" })).json();
    expect(snapshot.clients.filter((c: { builtin?: boolean }) => c.builtin)).toHaveLength(2);
  });
});

describe("import", () => {
  it("reports bounded import saturation as retryable service pressure", async () => {
    const { app } = freshApp(true, {
      importWorker: async () => {
        throw new WorkQueueFullError("Import preparation is temporarily at capacity. Retry shortly.");
      },
    });
    await post(app, "accounts", account("a1"));

    const response = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: exportFile("source") },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json()).toEqual({
      error: "Import preparation is temporarily at capacity. Retry shortly.",
      code: "IMPORT_BUSY",
      retryable: true,
    });
  });

  const exportFile = (accountId: string) => ({
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [client("src-c", accountId)],
      disciplines: [],
      projects: [project("src-p", accountId, "src-c")],
      phases: [],
      resources: [person("src-r", accountId)],
      activities: [activity("src-t", accountId, "src-p")],
      allocations: [
        allocation("src-al", accountId, "src-r", "src-t"),
        allocation("bad", accountId, "src-r", "no-activity"), // dropped: dangling activity
      ],
      timeOff: [],
    },
  });

  it("imports into an account with fresh ids + remapped FKs, dropping invalid rows", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: exportFile("whatever") },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.imported).toBe(5); // client, project, resource, activity, 1 valid allocation
    expect(out.skipped).toBe(1); // the dangling allocation
    const s = await state(app);
    const proj = s.projects[0];
    expect(proj.id).not.toBe("src-p");
    expect(proj.accountId).toBe("a1");
    expect(s.activities[0].projectId).toBe(proj.id); // FK rewired to the new project id
    expect(s.allocations).toHaveLength(1);
  });

  it("refuses a stale import instead of erasing a same-account write committed during preparation", async () => {
    const workerStarted = deferred();
    const releaseWorker = deferred();
    const auditedActions: string[] = [];
    const appendAudit = vi.fn((record: AuditEntry) => {
      auditedActions.push(record.action);
      return true;
    });
    const { app } = freshApp(true, {
      audit: { append: appendAudit, degraded: false },
      importWorker: async (request) => {
        workerStarted.resolve();
        await releaseWorker.promise;
        return runImportWorker(request);
      },
    });
    await post(app, "accounts", account("a1"));
    auditedActions.length = 0;

    const importing = call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: exportFile("source") },
    });
    await workerStarted.promise;

    const concurrentWrite = await post(app, "resources", person("concurrent", "a1"));
    expect(concurrentWrite.statusCode).toBe(201);
    releaseWorker.resolve();

    const response = await importing;
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "The company data changed while the import was being prepared. Retry the import from the latest data.",
      code: "IMPORT_SNAPSHOT_STALE",
    });
    const current = await state(app);
    expect(current.resources).toContainEqual(expect.objectContaining({ id: "concurrent", accountId: "a1" }));
    expect(current.clients).not.toContainEqual(expect.objectContaining({ name: "Acme", builtin: false }));
    expect(auditedActions).not.toContain("import");
  });

  it("does not conflict an import when another account changes during preparation", async () => {
    const workerStarted = deferred();
    const releaseWorker = deferred();
    const { app } = freshApp(true, {
      multiAccount: true,
      importWorker: async (request) => {
        workerStarted.resolve();
        await releaseWorker.promise;
        return runImportWorker(request);
      },
    });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));

    const importing = call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: exportFile("source") },
    });
    await workerStarted.promise;

    const concurrentWrite = await post(app, "resources", person("a2-concurrent", "a2"));
    expect(concurrentWrite.statusCode).toBe(201);
    releaseWorker.resolve();

    const response = await importing;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: 5, skipped: 1 });
    const current = await state(app);
    expect(current.resources).toContainEqual(expect.objectContaining({ id: "a2-concurrent", accountId: "a2" }));
    expect(current.projects).toContainEqual(expect.objectContaining({ accountId: "a1" }));
  });

  it("does not persist dependent private notes imported for a deleted resource", async () => {
    const { app, db } = freshApp();
    await post(app, "accounts", account("a1"));
    const deleted = {
      ...person("src-r", "source"),
      name: "Named Person",
      archivedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: "2026-01-03T00:00:00.000Z",
    };
    const file = {
      schemaVersion: 3,
      data: {
        accounts: [],
        clients: [client("src-c", "source")],
        disciplines: [],
        projects: [project("src-p", "source", "src-c")],
        phases: [],
        activities: [activity("src-t", "source", "src-p")],
        resources: [deleted],
        allocations: [
          allocation("src-al", "source", "src-r", "src-t", {
            note: "Private project context",
          }),
        ],
        timeOff: [
          {
            id: "src-to",
            accountId: "source",
            resourceId: "src-r",
            startDate: "2026-01-01",
            endDate: "2026-01-03",
            type: "sick",
            note: "Private medical detail",
            ...meta(),
          },
        ],
      },
    };

    const res = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: file },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 6, skipped: 0 });
    const importedResource = db.prepare(`SELECT name, deletedAt FROM resources WHERE accountId = 'a1'`).get() as {
      name: string;
      deletedAt: string | null;
    };
    expect(importedResource.name).toMatch(/^Removed person #[a-zA-Z0-9]{12}$/);
    expect(importedResource.deletedAt).toBe(deleted.deletedAt);
    expect(db.prepare(`SELECT note FROM allocations WHERE accountId = 'a1'`).get()).toEqual({ note: null });
    expect(db.prepare(`SELECT note FROM timeOff WHERE accountId = 'a1'`).get()).toEqual({ note: null });
  });

  it("drops records with dangling required FKs and unbinds dangling optional ones", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // A hand-edited file: a project/phase whose required parent is absent (must be
    // dropped before SQLite's FKs reject the whole import), and an activity/resource whose
    // OPTIONAL parent is absent (must survive, unbound to general / no discipline).
    const file = {
      schemaVersion: 3,
      data: {
        accounts: [],
        clients: [],
        disciplines: [],
        projects: [project("dp", "x", "ghost-client")], // dropped: missing client
        phases: [
          {
            id: "dph",
            accountId: "x",
            name: "P",
            projectId: "ghost-project",
            ...meta(),
          },
        ], // dropped
        resources: [{ ...person("dr", "x"), disciplineId: "ghost-disc" }], // kept, discipline unbound
        activities: [activity("dt", "x", "ghost-project")], // kept, unbound to a general activity
        allocations: [],
        timeOff: [],
      },
    };
    const res = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: file },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 2, skipped: 2 });
    const s = await state(app);
    expect(s.projects).toHaveLength(0);
    expect(s.phases).toHaveLength(0);
    expect(s.activities).toHaveLength(1);
    expect(s.activities[0].projectId).toBeUndefined(); // unbound → general activity
    expect(s.resources).toHaveLength(1);
    expect(s.resources[0].disciplineId).toBeUndefined(); // unbound discipline
  });

  it("runs the v1→v2 migration on imported data (isFreelancer → employmentType)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const lr = person("lr", "x") as Record<string, unknown>;
    delete lr.employmentType;
    lr.isFreelancer = true;
    const legacy = { schemaVersion: 1, data: { resources: [lr] } };
    await call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: legacy },
    });
    const s = await state(app);
    expect(s.resources[0].employmentType).toBe("freelancer");
    expect("isFreelancer" in s.resources[0]).toBe(false);
  });

  it("requires an accountId", async () => {
    const { app } = freshApp();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/import",
          payload: { data: {} },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects non-CapacityLens data", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: { nope: true } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed present schema version without replacing account data", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "resources", person("existing", "a1"));
    const before = await state(app);

    const res = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: {
        accountId: "a1",
        data: {
          schemaVersion: "10",
          data: {
            resources: [person("incoming", "source")],
            futureRecords: [{ id: "would-be-lost" }],
          },
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/schema version must be a non-negative safe integer/i);
    expect(await state(app)).toEqual(before);
  });
});

describe("tenant-scoped mutation projections", () => {
  it("distinguishes accepted batch operations from state-changing operations", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    const result = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "changed-client",
        row: client("changed-client", "a1"),
      },
      {
        method: "DELETE",
        table: "phases",
        id: "missing-phase",
        accountId: "a1",
      },
      {
        method: "DELETE",
        table: "activities",
        id: "missing-activity",
        accountId: "a1",
      },
    ]);

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ ok: true, applied: 3, changed: 1 });
    expect(result.json().revisions).toHaveLength(1);
  });

  it("does not materialize unrelated tables for empty/single-account batches or import", async () => {
    const { db, raw, fullTableSelects } = dbTrackingFullTableSelects();
    const app = buildApp(db, {
      multiAccount: true,
      optimisticConcurrency: false,
    });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    await post(app, "clients", client("unrelated-client", "a2"));
    fullTableSelects.length = 0;

    const emptyResult = await batch(app, []);
    const emptyBatchReads = fullTableSelects.splice(0).length;
    const batchResult = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "a1-client",
        row: client("a1-client", "a1"),
      },
    ]);
    const singleAccountBatchReads = fullTableSelects.splice(0).length;
    const importResult = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: {
        accountId: "a1",
        data: {
          schemaVersion: 3,
          data: {
            accounts: [],
            disciplines: [],
            resources: [],
            clients: [client("import-client", "source-account")],
            projects: [],
            phases: [],
            activities: [],
            allocations: [],
            timeOff: [],
          },
        },
      },
    });
    const importReads = fullTableSelects.splice(0).length;

    expect([emptyResult.statusCode, batchResult.statusCode, importResult.statusCode]).toEqual([200, 200, 200]);
    expect({ emptyBatchReads, singleAccountBatchReads, importReads }).toEqual({
      emptyBatchReads: 0,
      singleAccountBatchReads: 0,
      importReads: 0,
    });
    await app.close();
    raw.close();
  });
});

describe("guards", () => {
  it("rejects an oversized payload with 413", async () => {
    const { app } = freshApp();
    const huge = '{"id":"' + "a".repeat(6 * 1024 * 1024) + '"}';
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      headers: { "content-type": "application/json" },
      payload: huge,
    });
    expect(res.statusCode).toBe(413);
  });

  it("reset is 403 unless allowed, then wipes + re-seeds", async () => {
    const locked = buildApp(openDb(":memory:"), { allowReset: false });
    expect(
      (
        await call(locked, {
          method: "POST",
          url: "/api/test/reset",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    const { app } = freshApp(true);
    await scaffold(app);
    await call(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: true },
    });
    const s = await state(app);
    expect(s.accounts.length).toBeGreaterThan(0); // seeded demo data present
  });

  it("reset removes memberships and invitations for wiped companies", async () => {
    const { app, db } = freshApp(true);
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt)
      VALUES (?, ?, ?, ?, ?)`,
    ).run("old-account", "old-user", "owner", "active", TS);
    db.prepare(
      `INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("old-token-hash", "old-invite", "old-account", "viewer", null, TS, null, TS);

    expect((await call(app, { method: "POST", url: "/api/test/reset" })).statusCode).toBe(200);

    expect(db.prepare(`SELECT COUNT(*) AS count FROM account_members`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 0,
    });
  });

  it("rolls the wipe back when re-seeding fails", async () => {
    const { app, db } = freshApp(true);
    await scaffold(app);
    const accountsBefore = db.prepare(`SELECT id FROM accounts ORDER BY id`).all();
    db.exec(`
      CREATE TRIGGER reject_seeded_accounts
      BEFORE INSERT ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'forced seed failure');
      END
    `);

    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: true },
    });

    expect(response.statusCode).toBe(500);
    expect(db.prepare(`SELECT id FROM accounts ORDER BY id`).all()).toEqual(accountsBefore);
  });
});

describe("value-level sanitization on direct writes (server is the integrity boundary)", () => {
  it("stores a validated account colour without surrounding whitespace", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", { ...account("a1"), color: "  #aAbBcC  " })).statusCode).toBe(201);
    // #aabbcc is not itself a preset — sanitizeWrite snaps it to its NEAREST preset (shared
    // snapToPresetColor), not a fixed fallback colour. See the "snaps a non-preset account
    // colour to its nearest preset" test below for the policy this replaced.
    expect((await state(app)).accounts[0].color).toBe("#bed4f4");
  });

  it("snaps a non-preset account colour to its NEAREST preset, not a fixed fallback colour", async () => {
    // Regression guard for the old blanket-fallback bug: a colour close to one specific preset
    // must land on THAT preset, proving the guard is distance-based rather than always emitting
    // one fixed hex regardless of the input.
    // multiAccount: true — this test deliberately creates a SECOND company on one instance (see
    // the identical note at the other multiAccount call sites above).
    const { app } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", { ...account("a1"), color: "#7cd9e4" });
    expect((await state(app)).accounts[0].color).toBe("#7adae3");
    // A colour on the opposite side of the palette snaps to a DIFFERENT preset — proving the two
    // don't collapse onto the same fixed fallback.
    await post(app, "accounts", { ...account("a2"), color: "#f6c3bb" });
    const accounts = (await state(app)).accounts as Array<Record<string, unknown>>;
    expect(accounts.find((a) => a.id === "a2")?.color).toBe("#f5bcbc");
  });

  it("uses the same nearest-preset mapping for direct scoped-entity writes", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const response = await post(app, "resources", {
      ...person("r1", "a1"),
      color: "#eb7273",
    });

    expect(response.statusCode).toBe(201);
    expect((await state(app)).resources[0].color).toBe("#eb7272");
  });

  it("repairs junk fields and missing legacy halfDays/engagement values on POST", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // A hand-crafted request that bypasses the UI forms with every value-field wrong.
    const res = await post(app, "resources", {
      id: "r1",
      accountId: "a1",
      kind: "wizard", // invalid → 'person'
      role: "Designer",
      employmentType: "overlord", // invalid → 'permanent'
      workingHoursPerDay: -5, // invalid → 8
      workingDays: "nope", // invalid → [1..5]
      color: "not-a-colour", // invalid → fallback hex
      ...meta(),
    });
    expect(res.statusCode).toBe(201);
    const r = (await state(app)).resources[0] as Record<string, unknown>;
    expect(r.kind).toBe("person");
    expect(r.employmentType).toBe("permanent");
    expect(r.engagement).toBe("studio");
    expect(r.workingHoursPerDay).toBe(8);
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.halfDays).toEqual([]);
    expect(r.color).toBe("#5c34d4");
  });

  it("repairs a bad allocation status / hours on PUT", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await put(
      app,
      "allocations",
      "al1",
      allocation("al1", "a1", "r1", "t1", { status: "maybe", hoursPerDay: -3 }),
    );
    expect(res.statusCode).toBe(200);
    const a = (await state(app)).allocations[0] as Record<string, unknown>;
    expect(a.status).toBe("confirmed");
    // A finite out-of-range value clamps to the [0,24] FLOOR (0), matching the shared
    // store clamp — import + store now use one clampHoursPerDay, so they can't diverge.
    // (Only a missing / NaN value falls back to a full 8h day.)
    expect(a.hoursPerDay).toBe(0);
  });

  it("drops a junk account schedulingMode on a direct write but keeps a valid one", async () => {
    const { app } = freshApp();
    // A hand-crafted account write with a junk schedulingMode the scheduler can't handle.
    expect(
      (
        await post(app, "accounts", {
          ...account("a1"),
          schedulingMode: "wizard",
        })
      ).statusCode,
    ).toBe(201);
    expect((await state(app)).accounts[0].schedulingMode).toBeUndefined(); // junk dropped → 'hourly'
    // A valid mode persists unchanged.
    await patch(app, "accounts", "a1", { schedulingMode: "blocks" });
    expect((await state(app)).accounts[0].schedulingMode).toBe("blocks");
  });
});

describe("scheduling-mode fields round-trip through the DB", () => {
  it("persists account schedulingMode and a block allocation (hoursPerDay 0 + ignoreWeekends)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // Switch the company into blocks mode.
    expect((await patch(app, "accounts", "a1", { schedulingMode: "blocks" })).statusCode).toBe(200);
    // A block booking persists hoursPerDay 0 (load ignored) + ignoreWeekends true. The
    // 0 must NOT be sanitized up to a full day, and the boolean must round-trip.
    const res = await post(
      app,
      "allocations",
      allocation("al1", "a1", "r1", "t1", {
        hoursPerDay: 0,
        ignoreWeekends: true,
      }),
    );
    expect(res.statusCode).toBe(201);
    const s = await state(app);
    expect(s.accounts[0].schedulingMode).toBe("blocks");
    expect(s.allocations[0].hoursPerDay).toBe(0);
    expect(s.allocations[0].ignoreWeekends).toBe(true);
  });
});

describe("account frozen fields (P1.14): language / weekStartsOn / timezone", () => {
  // Seed an account carrying all three frozen fields (so a change is detectable).
  const FROZEN = {
    weekStartsOn: 1 as const,
    timezone: "Etc/GMT",
    language: "en",
  };
  async function seedFrozen(app: FastifyInstance) {
    expect((await post(app, "accounts", { ...account("a1"), ...FROZEN })).statusCode).toBe(201);
  }

  it("PATCH changing weekStartsOn → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    const res = await patch(app, "accounts", "a1", { weekStartsOn: 0 });
    expect(res.statusCode).toBe(409);
    expect((await state(app)).accounts[0].weekStartsOn).toBe(1); // unchanged
  });

  it("PATCH changing timezone → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch(app, "accounts", "a1", { timezone: "Europe/London" })).statusCode).toBe(409);
    expect((await state(app)).accounts[0].timezone).toBe("Etc/GMT");
  });

  it("PATCH with an unsupported language is sanitised to an unchanged no-op", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch(app, "accounts", "a1", { language: "fr" })).statusCode).toBe(200);
    expect((await state(app)).accounts[0].language).toBe("en");
  });

  it("PUT resending the row with a CHANGED frozen field → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    const res = await put(app, "accounts", "a1", {
      ...account("a1"),
      ...FROZEN,
      weekStartsOn: 0,
    });
    expect(res.statusCode).toBe(409);
    expect((await state(app)).accounts[0].weekStartsOn).toBe(1);
  });

  it("an UNCHANGED PUT of the frozen fields → 200 (change-not-presence)", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    // The sync adapter re-sends the WHOLE row on any edit (e.g. a rename) — an unchanged
    // frozen value present in the body must PASS.
    const res = await put(app, "accounts", "a1", {
      ...account("a1"),
      ...FROZEN,
      name: "Renamed",
    });
    expect(res.statusCode).toBe(200);
    expect((await state(app)).accounts[0].name).toBe("Renamed");
  });

  it("an UNCHANGED PATCH of a frozen field → 200", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch(app, "accounts", "a1", { weekStartsOn: 1 })).statusCode).toBe(200);
  });

  it("lets a minimal /api/orgs account set each missing frozen field once", async () => {
    const { app } = freshApp();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/orgs",
          payload: body({ id: "a1", name: "Studio" }),
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await patch(app, "accounts", "a1", {
          weekStartsOn: 0,
          timezone: "Europe/London",
          language: "en",
        })
      ).statusCode,
    ).toBe(200);
    expect((await patch(app, "accounts", "a1", { timezone: "Etc/GMT" })).statusCode).toBe(409);

    const stored = (await state(app)).accounts[0];
    expect(stored).toMatchObject({
      weekStartsOn: 0,
      timezone: "Europe/London",
      language: "en",
    });
  });

  it("treats sanitiser-dropped frozen values as no-ops across PUT, PATCH and batch", async () => {
    const { app } = freshApp();
    await seedFrozen(app);

    expect(
      (
        await patch(app, "accounts", "a1", {
          language: "fr",
          timezone: "Mars/Olympus",
          weekStartsOn: 2,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put(app, "accounts", "a1", {
          ...account("a1"),
          ...FROZEN,
          language: 123,
          timezone: null,
          weekStartsOn: -1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await batch(app, [
          {
            method: "PUT",
            table: "accounts",
            id: "a1",
            row: {
              ...account("a1"),
              ...FROZEN,
              language: "cy",
              timezone: "invalid",
              weekStartsOn: 7,
            },
          },
        ])
      ).statusCode,
    ).toBe(200);

    expect((await state(app)).accounts[0]).toMatchObject(FROZEN);
  });

  it("PATCH mutable account preferences, including engagement grouping", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch(app, "accounts", "a1", { name: "New Name" })).statusCode).toBe(200);
    expect((await patch(app, "accounts", "a1", { disciplinesEnabled: true })).statusCode).toBe(200);
    expect((await patch(app, "accounts", "a1", { groupResourcesByEngagement: false })).statusCode).toBe(200);
    expect((await patch(app, "accounts", "a1", { schedulingMode: "blocks" })).statusCode).toBe(200);
    expect((await state(app)).accounts[0].groupResourcesByEngagement).toBe(false);
  });

  it("a batch PUT changing a frozen field returns the same reloadable 409 as direct writes", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    // Documented asymmetry: the batch maps a ValidationError to 400 (vs the per-route 409).
    const res = await batch(app, [
      {
        method: "PUT",
        table: "accounts",
        id: "a1",
        row: { ...account("a1"), ...FROZEN, timezone: "Europe/London" },
      },
    ]);
    expect(res.statusCode).toBe(409);
    expect((await state(app)).accounts[0].timezone).toBe("Etc/GMT"); // tx rolled back
  });
});

describe("error status mapping (statusFor)", () => {
  it("maps validation + constraint errors to 400 and unexpected errors to 500", () => {
    expect(statusFor(new ValidationError("bad ref"))).toBe(400);
    expect(
      statusFor(
        Object.assign(new Error("FOREIGN KEY constraint failed"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 787,
        }),
      ),
    ).toBe(400);
    expect(
      statusFor(
        Object.assign(new Error("NOT NULL constraint failed: resources.role"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1299,
        }),
      ),
    ).toBe(400);
    expect(
      statusFor(
        Object.assign(new Error("forced erasure failure"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1811,
        }),
      ),
    ).toBe(500);
    expect(statusFor(new Error("upstream constraint failed unexpectedly"))).toBe(500);
    expect(statusFor(new Error("something unexpected blew up"))).toBe(500);
    expect(statusFor("a string")).toBe(500);
  });

  // PINNING TEST: these trigger real node:sqlite violations so the classifier stays tied to the
  // runtime's structured error metadata for each supported row-data constraint family.
  describe("pins node:sqlite constraint metadata on real violations", () => {
    const grab = (fn: () => void): Error => {
      try {
        fn();
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected a constraint violation, but none was thrown");
    };

    const expectConstraint = (error: Error): void => {
      expect(error).toMatchObject({ code: "ERR_SQLITE_ERROR" });
      expect((error as Error & { errcode: number }).errcode & 0xff).toBe(19);
      expect(statusFor(error)).toBe(400);
    };

    it("maps a real NOT NULL violation to 400", () => {
      const db = openDb(":memory:");
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', NULL, '#fff', 't', 't')`),
      );
      expectConstraint(e);
    });

    it("maps a real UNIQUE/PRIMARY KEY violation to 400", () => {
      const db = openDb(":memory:");
      db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Studio', '#fff', 't', 't')`);
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Dup', '#fff', 't', 't')`),
      );
      expectConstraint(e);
    });

    it("maps a real FOREIGN KEY violation to 400", () => {
      const db = openDb(":memory:"); // openDb turns foreign_keys ON
      const e = grab(() =>
        db.exec(
          `INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt) VALUES ('c', 'no-such-account', 'Acme', '#fff', 't', 't')`,
        ),
      );
      expectConstraint(e);
    });
  });
});

describe("global error redaction", () => {
  it("does not trust an arbitrary sub-500 statusCode as proof that its message is public", async () => {
    const app = buildApp(openDb(":memory:"));
    const sentinel = "PRIVATE schema path /srv/capacitylens.db clients.color";
    const cause = Object.assign(new Error(sentinel), { statusCode: 400 });
    const constraintPhraseCause = new Error("upstream constraint failed unexpectedly");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    app.get("/api/test/decorated-client-error", () => {
      throw cause;
    });
    app.get("/api/test/spoofed-framework-error", () => {
      throw Object.assign(new Error(sentinel), {
        code: "FST_ERR_CTP_BODY_TOO_LARGE",
        statusCode: 413,
      });
    });
    app.get("/api/test/non-sqlite-constraint-phrase", () => {
      throw constraintPhraseCause;
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/test/decorated-client-error",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal server error" });
      expect(response.body).not.toContain(sentinel);
      expect(consoleError).toHaveBeenCalledWith(cause);

      const spoofed = await app.inject({
        method: "GET",
        url: "/api/test/spoofed-framework-error",
      });
      expect(spoofed.statusCode).toBe(413);
      expect(spoofed.json()).toEqual({ error: "Request body is too large" });
      expect(spoofed.body).not.toContain(sentinel);

      consoleError.mockClear();
      const unrelated = await app.inject({
        method: "GET",
        url: "/api/test/non-sqlite-constraint-phrase",
      });
      expect(unrelated.statusCode).toBe(500);
      expect(unrelated.json()).toEqual({ error: "Internal server error" });
      expect(unrelated.body).not.toContain(constraintPhraseCause.message);
      expect(consoleError).toHaveBeenCalledWith(constraintPhraseCause);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("CORS allow-list", () => {
  it("defaults FAIL-CLOSED to the localhost allow-list (not a wildcard)", async () => {
    const { app } = freshApp();
    // A local dev origin is reflected (it's on the default allow-list)…
    const local = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    // …but an arbitrary site gets NO ACAO header (the browser blocks it) — the factory
    // never opens to '*' unless explicitly told to.
    const evil = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects '*' because credentialed CORS requires explicit origins", () => {
    expect(() => buildApp(openDb(":memory:"), { corsOrigin: "*" })).toThrow(/explicit/i);
  });

  it("normalizes harmless origin spellings and rejects non-origin URLs at startup", async () => {
    const app = buildApp(openDb(":memory:"), {
      corsOrigin: "HTTPS://APP.EXAMPLE.COM:443/,http://localhost:80",
    });

    const canonicalHttps = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://app.example.com" },
    });
    expect(canonicalHttps.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const canonicalHttp = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost" },
    });
    expect(canonicalHttp.headers["access-control-allow-origin"]).toBe("http://localhost");

    for (const corsOrigin of [
      "not an origin",
      "ftp://app.example.com",
      "https://user@app.example.com",
      "https://app.example.com/path",
      "https://app.example.com?query=1",
      "https://app.example.com#fragment",
    ]) {
      expect(() => buildApp(openDb(":memory:"), { corsOrigin })).toThrow(/bare HTTP\(S\) origin/i);
    }
  });

  it("reflects an allowed origin and omits the header for a disallowed one", async () => {
    const app = buildApp(openDb(":memory:"), {
      corsOrigin: "http://good.test,http://also.test",
    });
    const ok = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://good.test" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://good.test");
    const bad = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("pairs Allow-Credentials with every reflected explicit origin (P3.4)", async () => {
    // The client sends credentials: 'include' on every request; a credentialed
    // cross-origin response without this header is refused by the browser.
    const { app } = freshApp();
    const reflected = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(reflected.headers["access-control-allow-credentials"]).toBe("true");
    const disallowed = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(disallowed.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("answers a write preflight with 204 + CORS headers (no OPTIONS route exists)", async () => {
    // Regression guard: every cross-origin write (JSON POST/PUT/PATCH/DELETE) is
    // preflighted by the browser, and OPTIONS matches no route — the 204 comes from the
    // ROOT-level onRequest hook on the not-found path. When the hook briefly moved into
    // the routes child plugin, preflights became bare 404s without CORS headers and the
    // db-backed e2e app could no longer save anything.
    const { app } = freshApp();
    const res = await call(app, {
      method: "OPTIONS",
      url: "/api/batch",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("rejects unsafe browser requests from a disallowed Origin before the handler runs", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("rejects cross-site Fetch Metadata even when Origin is absent", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("keeps non-browser clients and allowed same-origin writes working", async () => {
    const { app } = freshApp();
    expect((await call(app, { method: "POST", url: "/api/test/reset" })).statusCode).toBe(200);
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/test/reset",
          headers: {
            origin: "http://localhost:5173",
            "sec-fetch-site": "same-site",
          },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("accepts the packaged same-origin proxy path without requiring a redundant CORS allow-list", async () => {
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
      trustProxyHeaders: true,
    });
    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://capacity.example.com",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://capacity.example.com");
  });

  it("falls back to exact trusted-proxy scheme and Host comparison without Fetch Metadata", async () => {
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
      trustProxyHeaders: true,
    });
    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com:8443",
        origin: "https://capacity.example.com:8443",
        "x-forwarded-proto": "https",
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("lets a cross-site write through when its Origin is on the credentialed allow-list (Fetch Metadata notwithstanding)", async () => {
    // FIX: an Origin EXACTLY on the CORS allow-list is the operator's explicit cross-site contract,
    // so it must pass the gate even when the browser labels the request Sec-Fetch-Site: cross-site
    // (the legitimate configured cross-origin call). The old gate 403'd it on the fetchSite clause
    // despite the allow-list match; now the allow-listed Origin is reflected and the write proceeds.
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "https://app.example.com",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  it("still 403s a genuinely cross-site write from a NON-listed Origin", async () => {
    // The allow-list exemption is exact-match only; an Origin that is neither allow-listed nor
    // same-origin, carrying a cross-site signal, remains a hard 403.
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "https://app.example.com",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("treats a TLS-terminated https Origin as same-origin when only the scheme differs from http req.protocol", async () => {
    // FIX: with no Fetch Metadata and forwarded-proto NOT trusted, the standard TLS-termination
    // deploy has the browser-set Origin claim https:// while req.protocol sees http (cleartext hop
    // behind the proxy). When the Origin's host:port matches our Host and the ONLY difference is
    // that scheme upgrade, it is same-origin — the browser sets the Origin host, so it can't be
    // forged from another site. No allow-list entry and no trustProxyHeaders here.
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://capacity.example.com",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("still 403s when the https Origin host does NOT match the request Host", async () => {
    // The scheme-upgrade exemption is host-pinned: a mismatched host stays a cross-site 403.
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://other.example.com",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns a clean 403 (not a 500) when a broken proxy sends a malformed Host header", async () => {
    // REGRESSION: the same-origin check reconstructs `${protocol}://${host}` from the Host header, an
    // untrusted, proxy-influenced string. A broken proxy (or a forged request) can send a Host that
    // `new URL` rejects — here 'exa mple.com' (embedded space). That reconstruct MUST be guarded: an
    // unparseable Host is "cannot prove same-origin" → fail closed → clean cross-site 403. A refactor
    // once moved the reconstruct out of the try/catch, turning this into an uncaught TypeError → 500.
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { host: "exa mple.com", origin: "https://capacity.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("returns a clean 403 for other unparseable Host shapes from a broken proxy", async () => {
    // Same total-function guarantee across the other Host shapes a broken proxy can emit: a lone '['
    // (unterminated IPv6 bracket) and a double-port 'host:port:port'. Every one fails closed to 403.
    const app = buildApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    for (const host of ["[", "capacity.example.com:8443:9000"]) {
      const res = await call(app, {
        method: "POST",
        url: "/api/test/reset",
        headers: { host, origin: "https://capacity.example.com" },
      });
      expect(res.statusCode, `host=${host}`).toBe(403);
    }
  });

  it("Allow-Headers lists JSON plus both operator-secret headers", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "OPTIONS",
      url: "/api/orgs",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "content-type, x-capacitylens-bootstrap-token, x-capacitylens-setup-token, x-capacitylens-sync-session, x-capacitylens-sync-sequence",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-bootstrap-token");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-setup-token");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-sync-session");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-sync-sequence");
    expect(res.headers["access-control-expose-headers"]).toContain("x-capacitylens-audit-warning");
  });
});

describe("sensitive response caching", () => {
  it("sets no-store on health, errors, and authenticated API responses", async () => {
    const { app } = freshApp();
    for (const request of [
      { method: "GET" as const, url: "/api/health" },
      { method: "GET" as const, url: "/api/state" },
      { method: "GET" as const, url: "/api/does-not-exist" },
    ]) {
      const res = await call(app, request);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.pragma).toBe("no-cache");
    }
  });
});

describe("optimistic concurrency (default-on)", () => {
  it("rejects a stale PUT with 409 when enabled; allows same/newer", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    // Store a client at T2.
    const created = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    // A PUT carrying an OLDER updatedAt (T1) is a stale overwrite → 409.
    const stale = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      name: "Stale",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(stale.statusCode).toBe(409);
    expect((await state(app)).clients[0].name).toBe("Acme"); // not overwritten
    // A PUT at a newer time succeeds.
    const fresh = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      name: "Fresh",
      updatedAt: created.json().updatedAt,
    });
    expect(fresh.statusCode).toBe(200);
    expect((await state(app)).clients[0].name).toBe("Fresh");
  });

  it("rejects a stale PATCH and accepts one carrying the current server revision", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put(app, "clients", "c1", client("c1", "a1"));
    const stale = await patch(app, "clients", "c1", {
      name: "Stale",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(stale.statusCode).toBe(409);
    const fresh = await patch(app, "clients", "c1", {
      name: "Fresh",
      updatedAt: created.json().updatedAt,
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().name).toBe("Fresh");
    expect(Date.parse(fresh.json().updatedAt)).not.toBeNaN();
  });

  it("can be explicitly disabled for a trusted single-writer deployment", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const stale = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      name: "Stale",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(stale.statusCode).toBe(200);
    expect((await state(app)).clients[0].name).toBe("Stale");
  });

  // The batch PUT branch applies the SAME stale-write refusal as the direct PUT (it previously
  // had none — a stale client batch could silently overwrite newer server rows even with the flag
  // on). The 409 carries the stored row as `current`, and — the batch being one tx — rolls the
  // WHOLE batch back, sibling ops included.
  it("batch: rejects a stale PUT op with 409 + current when enabled, rolling back the WHOLE batch", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const res = await batch(app, [
      // A fresh sibling op that would succeed alone — it must NOT survive the rollback.
      {
        method: "PUT",
        table: "clients",
        id: "c2",
        row: { ...client("c2", "a1"), updatedAt: "2026-02-03T00:00:00.000Z" },
      },
      // The stale op: older updatedAt than the stored row → conflict.
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Stale",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    ]);
    expect(res.statusCode).toBe(409);
    // The direct PUT route's exact conflict shape: a message + the stored row for client re-sync.
    expect(res.json().error).toBe("The record was modified more recently on the server.");
    expect(res.json().current).toMatchObject({
      id: "c1",
      name: "Acme",
      updatedAt: created.json().updatedAt,
    });
    const s = await state(app);
    expect(s.clients.map((c: { id: string }) => c.id)).toEqual(["c1"]); // c2 rolled back with the batch
    expect(s.clients[0].name).toBe("Acme"); // c1 not overwritten
  });

  it("batch: a fresh (same/newer updatedAt) PUT op passes with the flag on", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Fresh",
          updatedAt: created.json().updatedAt,
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().revisions).toEqual([
      expect.objectContaining({
        table: "clients",
        id: "c1",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);
    expect((await state(app)).clients[0].name).toBe("Fresh");
  });

  it("rejects existing-row PUTs that omit the required revision precondition", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const noStamp: Record<string, unknown> = { ...client("c1", "a1") };
    delete noStamp.updatedAt;
    const viaBatch = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...noStamp, name: "NoStamp" },
      },
    ]);
    const viaPut = await put(app, "clients", "c1", {
      ...noStamp,
      name: "NoStamp",
    });
    expect(viaBatch.statusCode).toBe(viaPut.statusCode);
    expect(viaBatch.statusCode).toBe(409);
    expect((await state(app)).clients[0].name).toBe("Acme");
  });

  it("rejects a future-authored revision instead of treating it as fresher than the server", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put(app, "clients", "c1", client("c1", "a1"));

    const res = await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      name: "Future overwrite",
      updatedAt: "9999-12-31T23:59:59.999Z",
    });

    expect(res.statusCode).toBe(409);
    expect((await state(app)).clients[0].name).toBe("Acme");
  });

  it("accepts a partial PATCH that omits updatedAt (a normal partial edit is never a 409)", async () => {
    // The PATCH route calls isStaleWrite unconditionally; a partial PATCH legitimately omits
    // updatedAt, so it must NOT be treated as a stale conflict — otherwise every ordinary partial
    // edit 409s. Restored documented semantics: no incoming updatedAt ⇒ no basis for a conflict.
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put(app, "clients", "c1", client("c1", "a1"));
    const res = await patch(app, "clients", "c1", { name: "Renamed" });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed");
    expect(Date.parse(res.json().updatedAt)).not.toBeNaN();
  });

  it("rejects null for a required PATCH field without rewriting the stored value", async () => {
    const app = buildApp(openDb(":memory:"));
    await post(app, "accounts", account("a1"));
    await put(app, "clients", "c1", client("c1", "a1"));

    const res = await patch(app, "clients", "c1", { name: null });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/required field.*cannot be null/i);
    expect((await state(app)).clients[0].name).toBe("Acme");
  });

  it("keeps writing to a row whose STORED updatedAt is unparseable (never write-bricked)", async () => {
    // Regression: the inverted predicate returned "stale" whenever a timestamp failed to parse, so a
    // row with a corrupt/legacy stored updatedAt 409'd on EVERY write — permanently unrecoverable.
    // With the fix an unparseable stored side is simply "no basis for a conflict", so the write
    // proceeds and the server re-stamps a fresh valid updatedAt.
    const db = openDb(":memory:");
    const app = buildApp(db, { optimisticConcurrency: true });
    insertRow(db, "accounts", account("a1"));
    insertRow(db, "clients", {
      ...client("c1", "a1"),
      updatedAt: "not-a-real-timestamp",
    });
    const res = await patch(app, "clients", "c1", {
      name: "Recovered",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Recovered");
    expect(Date.parse(res.json().updatedAt)).not.toBeNaN();
  });

  it.each(["9999-12-31T23:59:59.999Z", "+010000-01-01T00:00:00.000Z", "+275760-09-13T00:00:00.000Z"])(
    "repairs an unincrementable or expanded stored revision through the API: %s",
    async (storedRevision) => {
      const db = openDb(":memory:");
      const app = buildApp(db, { optimisticConcurrency: false });
      insertRow(db, "accounts", account("a1"));
      insertRow(db, "clients", { ...client("c1", "a1"), updatedAt: storedRevision });

      const res = await patch(app, "clients", "c1", { name: "Recovered boundary" });

      expect(res.statusCode).toBe(200);
      expect(isIsoInstant(res.json().updatedAt)).toBe(true);
      expect(res.json().updatedAt).not.toBe(storedRevision);
    },
  );

  it("batch: explicit opt-out restores last-writer-wins semantics", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    await put(app, "clients", "c1", {
      ...client("c1", "a1"),
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Stale",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect((await state(app)).clients[0].name).toBe("Stale");
  });

  it.each([true, false])(
    "ordered browser batches preserve the newer edit when sequence 1 commits before sequence 2 (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = buildApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const created = await put(app, "clients", "c1", client("c1", "a1"));
      const baseRevision = created.json().updatedAt as string;
      const sessionId = "browser-session-0001";
      const first = await orderedBatch(app, sessionId, 1, [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: {
            ...client("c1", "a1"),
            name: "First",
            updatedAt: baseRevision,
          },
        },
      ]);
      const second = await orderedBatch(app, sessionId, 2, [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: {
            ...client("c1", "a1"),
            name: "Newest",
            updatedAt: baseRevision,
          },
        },
      ]);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json().superseded).toBeUndefined();
      expect((await state(app)).clients[0].name).toBe("Newest");
    },
  );

  it.each([true, false])(
    "ordered browser batches preserve the newer edit when sequence 2 arrives before sequence 1 (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = buildApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const created = await put(app, "clients", "c1", client("c1", "a1"));
      const baseRevision = created.json().updatedAt as string;
      const sessionId = "browser-session-0002";
      const second = await orderedBatch(app, sessionId, 2, [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: {
            ...client("c1", "a1"),
            name: "Newest",
            updatedAt: baseRevision,
          },
        },
      ]);
      const first = await orderedBatch(app, sessionId, 1, [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: {
            ...client("c1", "a1"),
            name: "First",
            updatedAt: baseRevision,
          },
        },
      ]);

      expect(second.statusCode).toBe(200);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        ok: true,
        applied: 1,
        superseded: true,
      });
      expect((await state(app)).clients[0].name).toBe("Newest");
    },
  );

  it.each([true, false])(
    "an ordered teardown archive fences an older in-flight lifecycle creation (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = buildApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const pendingClient = client("c1", "a1");
      const sessionId = "browser-session-lifecycle-0001";

      const teardown = await orderedBatch(app, sessionId, 2, [
        {
          method: "ARCHIVE",
          table: "clients",
          id: "c1",
          accountId: "a1",
          updatedAt: pendingClient.updatedAt,
        },
      ]);
      const olderCreation = await orderedBatch(app, sessionId, 1, [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: pendingClient,
        },
      ]);

      expect(teardown.statusCode).toBe(200);
      expect(teardown.json()).toMatchObject({ ok: true, applied: 1, changed: 0 });
      expect(olderCreation.statusCode).toBe(200);
      expect(olderCreation.json()).toMatchObject({ ok: true, applied: 1, superseded: true });
      expect((await state(app)).clients).toEqual([]);
    },
  );

  it("applies an ordered lifecycle archive atomically and retains its inactive row", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db);
    await post(app, "accounts", account("a1"));
    const created = await put(app, "clients", "c1", client("c1", "a1"));

    const response = await orderedBatch(app, "browser-session-lifecycle-0002", 1, [
      {
        method: "ARCHIVE",
        table: "clients",
        id: "c1",
        accountId: "a1",
        updatedAt: created.json().updatedAt,
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, applied: 1, changed: 1 });
    expect(getRow(db, "clients", "c1")).toMatchObject({ accountId: "a1", archivedAt: expect.any(String) });
  });

  it("ordered successor still rejects a stale write after an intervening external edit", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    const created = await put(app, "clients", "c1", client("c1", "a1"));
    const baseRevision = created.json().updatedAt as string;
    const sessionId = "browser-session-0003";
    await orderedBatch(app, sessionId, 1, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...client("c1", "a1"), name: "First", updatedAt: baseRevision },
      },
    ]);
    const afterFirst = (await state(app)).clients[0];
    await put(app, "clients", "c1", { ...afterFirst, name: "External" });
    const successor = await orderedBatch(app, sessionId, 2, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...client("c1", "a1"), name: "Newest", updatedAt: baseRevision },
      },
    ]);

    expect(successor.statusCode).toBe(409);
    expect((await state(app)).clients[0].name).toBe("External");
  });

  it("ordered stale DELETE rolls back its batch and preserves an externally edited row", async () => {
    const app = buildApp(openDb(":memory:"), { optimisticConcurrency: false });
    await scaffold(app);
    const created = await post(app, "allocations", allocation("al1", "a1", "r1", "t1"));
    const createdRow = created.json() as Record<string, unknown>;
    const baseRevision = createdRow.updatedAt as string;
    const external = await put(app, "allocations", "al1", {
      ...createdRow,
      note: "Committed by another browser",
      updatedAt: baseRevision,
    });
    expect(external.statusCode).toBe(200);
    expect(external.json().updatedAt).not.toBe(baseRevision);

    const staleDelete = await orderedBatch(app, "stale-delete-browser-1", 1, [
      {
        method: "PUT",
        table: "disciplines",
        id: "rolled-back",
        row: {
          id: "rolled-back",
          accountId: "a1",
          name: "Must not persist",
          color: "#5c34d4",
          sortOrder: 0,
          ...meta(),
        },
      },
      {
        method: "DELETE",
        table: "allocations",
        id: "al1",
        accountId: "a1",
        updatedAt: baseRevision,
      },
    ]);

    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json()).toMatchObject({
      error: "The record was modified more recently on the server.",
      current: {
        id: "al1",
        note: "Committed by another browser",
        updatedAt: external.json().updatedAt,
      },
    });
    const current = await state(app);
    expect(current.allocations).toEqual([
      expect.objectContaining({
        id: "al1",
        note: "Committed by another browser",
      }),
    ]);
    expect(current.disciplines).toEqual([]);
  });

  it.each(["first-before-undo", "undo-before-first"])(
    "ordered creation followed by a non-lifecycle deletion cannot be resurrected (%s)",
    async (arrivalOrder) => {
      const app = buildApp(openDb(":memory:"), {
        optimisticConcurrency: false,
      });
      await post(app, "accounts", account("a1"));
      const sessionId = `browser-session-${arrivalOrder}`;
      const row = {
        id: "d1",
        accountId: "a1",
        name: "Temporary",
        color: "#5c34d4",
        sortOrder: 0,
        createdAt: TS,
        updatedAt: TS,
      };
      const create = () => orderedBatch(app, sessionId, 1, [{ method: "PUT", table: "disciplines", id: "d1", row }]);
      const undo = () =>
        orderedBatch(app, sessionId, 2, [
          {
            method: "DELETE",
            table: "disciplines",
            id: "d1",
            accountId: "a1",
            updatedAt: TS,
          },
        ]);

      const responses =
        arrivalOrder === "first-before-undo" ? [await create(), await undo()] : [await undo(), await create()];

      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      expect((await state(app)).disciplines).toEqual([]);
    },
  );
});

describe("batch op-count cap (MAX_BATCH_OPS)", () => {
  it(`rejects a batch of more than ${MAX_BATCH_OPS} ops with 400 before anything is written`, async () => {
    const { app } = freshApp();
    // Op count (not just body bytes) bounds parsing, authorization, scoped projection updates and
    // writes — the cap must fire BEFORE the pre-scan/tx, leaving the DB untouched.
    const ops = Array.from({ length: MAX_BATCH_OPS + 1 }, (_, i) => ({
      method: "PUT",
      table: "accounts",
      id: `flood-${i}`,
      row: account(`flood-${i}`),
    }));
    const res = await batch(app, ops);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain(String(MAX_BATCH_OPS));
    expect((await state(app)).accounts).toHaveLength(0); // nothing written
  });

  it(`allows a batch of exactly ${MAX_BATCH_OPS} ops (boundary, inclusive)`, async () => {
    const { app, db } = freshApp();
    await post(app, "accounts", account("a1"));
    // Exercise the expensive shape the cap is intended to contain: real updates against a
    // pre-populated table, not missing-row DELETE padding. Batch validation and projection updates
    // use indexes, so this remains proportional to the operation count plus one account-slice read.
    tx(db, () => {
      for (let index = 0; index < MAX_BATCH_OPS; index += 1) {
        upsertRow(db, "clients", client(`client-${index}`, "a1"));
      }
    });
    const ops = Array.from({ length: MAX_BATCH_OPS }, (_, index) => ({
      method: "PUT",
      table: "clients",
      id: `client-${index}`,
      row: { ...client(`client-${index}`, "a1"), name: `Updated ${index}` },
    }));
    const startedAt = performance.now();
    const res = await batch(app, ops);
    const handlerMs = performance.now() - startedAt;
    expect(res.statusCode).toBe(200);
    expect(handlerMs).toBeLessThan(MAX_BATCH_HANDLER_BUDGET_MS);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE name LIKE 'Updated %'`).get() as { n: number }).n).toBe(
      MAX_BATCH_OPS,
    );
  });
});

describe("null-id rejection (POST/batch without id → 400)", () => {
  it("POST without an id is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      name: "No Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/id/);
    // nothing persisted
    expect((await state(app)).accounts).toHaveLength(0);
  });

  it("POST with id: null is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      id: null,
      name: "Null Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/id/);
  });

  it("POST with empty-string id is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      id: "",
      name: "Empty Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/id/);
  });

  it("batch PUT op with a missing/non-string id is rejected with 400", async () => {
    const { app } = freshApp();
    // A batch op whose id field is not a string — the batch handler rejects it before
    // it can reach sanitizeWrite (typeof id !== 'string' check).
    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: body({
        ops: [
          {
            method: "PUT",
            table: "accounts",
            row: { name: "No Id", color: "#3b82f6", ...meta() },
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((await state(app)).accounts).toHaveLength(0);
  });
});

describe("absent/null request body on generic writes → 400, not 500", () => {
  // POST /api/:entity used to dereference the body (body.accountId! for a scoped table,
  // sanitizeWrite's assertIdPresent for accounts) BEFORE any 400 classification could run, so a
  // missing/null body crashed as an unclassified TypeError → statusFor → 500. /api/batch and
  // /api/import already guard `!body` this way; the generic routes now match.
  it("POST /api/resources with no body/Content-Type is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, { method: "POST", url: "/api/resources" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/resources with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/resources",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/accounts with no body/Content-Type is 400, not 500", async () => {
    // Regression for the accounts branch specifically: it skips the scoped-table authorize
    // dereference and instead crashed inside sanitizeWrite's assertIdPresent (row.id on null/undefined).
    const { app } = freshApp();
    const res = await call(app, { method: "POST", url: "/api/accounts" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/accounts with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  // The sibling handler: PATCH /api/:entity/:id ran entirely inside a try/catch, but a null body
  // still surfaced as 500 — accountFieldsFrozen's `field in incoming` throws on null, and the
  // caught TypeError isn't a ValidationError/constraint-failed, so statusFor mapped it to 500.
  it("PATCH /api/accounts/:id with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, {
      method: "PATCH",
      url: "/api/accounts/a1",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("PATCH /api/accounts/:id with no body/Content-Type is 400, not 500", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, { method: "PATCH", url: "/api/accounts/a1" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });
});

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  // Seed the fixture account + dependency chain, then write each entity via POST and
  // GET it back via /api/state. Deep-equal catches any column that is present in the
  // spec but not round-tripping correctly (NULL/optional handling, JSON encode/decode).
  async function seedFixtureDeps(app: FastifyInstance) {
    expect((await post(app, "accounts", FIXTURE_ACCOUNT)).statusCode).toBe(201);
    expect((await post(app, "clients", FIXTURE_CLIENT)).statusCode).toBe(201);
    expect((await post(app, "disciplines", FIXTURE_DISCIPLINE)).statusCode).toBe(201);
    expect((await post(app, "projects", FIXTURE_PROJECT)).statusCode).toBe(201);
    expect((await post(app, "phases", FIXTURE_PHASE)).statusCode).toBe(201);
  }

  // Generic writes (POST/PUT/PATCH/batch) STRIP lifecycle tombstones (the P2.1 write guard in
  // sanitizeWrite): only the dedicated archive/delete routes may set archivedAt/deletedAt. So a fixture
  // round-tripped through POST comes back MINUS its tombstones — those columns' persistence is covered
  // by app.lifecycle.test.ts (archive/delete → includeInactive read). Stripping them here keeps this
  // column-spec-gap check honest for every OTHER field on clients/projects/resources.
  function stripTombstones<T extends { archivedAt?: string; deletedAt?: string }>(fixture: T): T {
    const copy = { ...fixture };
    delete copy.archivedAt;
    delete copy.deletedAt;
    return copy;
  }

  function expectFixture(actual: object, expected: object) {
    expect(withoutRevision(actual)).toEqual(withoutRevision(expected));
    const revision = actual as { createdAt?: unknown; updatedAt?: unknown };
    expect(Date.parse(String(revision.createdAt))).not.toBeNaN();
    expect(Date.parse(String(revision.updatedAt))).not.toBeNaN();
  }

  it("account: every field round-trips (including optional schedulingMode)", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", FIXTURE_ACCOUNT)).statusCode).toBe(201);
    expectFixture((await state(app)).accounts[0], FIXTURE_ACCOUNT);
  });

  it("client: every field round-trips (lifecycle archivedAt/deletedAt stripped by generic writes)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    expect((await post(app, "clients", FIXTURE_CLIENT)).statusCode).toBe(201);
    expectFixture((await state(app)).clients[0], stripTombstones(FIXTURE_CLIENT));
  });

  it("discipline: every field round-trips (including optional color)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    expect((await post(app, "disciplines", FIXTURE_DISCIPLINE)).statusCode).toBe(201);
    expectFixture((await state(app)).disciplines[0], FIXTURE_DISCIPLINE);
  });

  it("project: every field round-trips (lifecycle archivedAt/deletedAt stripped by generic writes)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    await post(app, "clients", FIXTURE_CLIENT);
    expect((await post(app, "projects", FIXTURE_PROJECT)).statusCode).toBe(201);
    expectFixture((await state(app)).projects[0], stripTombstones(FIXTURE_PROJECT));
  });

  it("phase: every field round-trips", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    await post(app, "clients", FIXTURE_CLIENT);
    await post(app, "projects", FIXTURE_PROJECT);
    expect((await post(app, "phases", FIXTURE_PHASE)).statusCode).toBe(201);
    expectFixture((await state(app)).phases[0], FIXTURE_PHASE);
  });

  it("resource: every field round-trips (including optional name/disciplineId/projectId + json workingDays + lifecycle archivedAt/deletedAt)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE)).statusCode).toBe(201);
    expectFixture((await state(app)).resources[0], stripTombstones(FIXTURE_RESOURCE));
  });

  it("person resource: Supplementary engagement round-trips independently of employment", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    const supplementary = {
      ...person("supplementary-person", FIXTURE_ACCOUNT.id),
      name: "Fixture Supplementary Person",
      employmentType: "permanent" as const,
      engagement: "supplementary" as const,
    };

    expect((await post(app, "resources", supplementary)).statusCode).toBe(201);
    expect((await state(app)).resources[0]).toMatchObject({
      employmentType: "permanent",
      engagement: "supplementary",
    });
  });

  it("external resource: kind + company name round-trip (no discipline/project binding)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE_EXTERNAL)).statusCode).toBe(201);
    expectFixture((await state(app)).resources[0], FIXTURE_RESOURCE_EXTERNAL);
  });

  it("activity: every field round-trips (including optional projectId/phaseId)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "activities", FIXTURE_ACTIVITY)).statusCode).toBe(201);
    expectFixture((await state(app)).activities[0], FIXTURE_ACTIVITY);
  });

  it("internal + repeatable activities round-trip with kind and no projectId/phaseId", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "activities", FIXTURE_ACTIVITY_INTERNAL)).statusCode).toBe(201);
    expect((await post(app, "activities", FIXTURE_ACTIVITY_REPEATABLE)).statusCode).toBe(201);
    const activities = (await state(app)).activities;
    expectFixture(
      activities.find((a: { id: string }) => a.id === FIXTURE_ACTIVITY_INTERNAL.id),
      FIXTURE_ACTIVITY_INTERNAL,
    );
    expectFixture(
      activities.find((a: { id: string }) => a.id === FIXTURE_ACTIVITY_REPEATABLE.id),
      FIXTURE_ACTIVITY_REPEATABLE,
    );
  });

  it("allocation: every field round-trips (including optional note + json ignoreWeekends + hoursPerDay 0)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    await post(app, "resources", FIXTURE_RESOURCE);
    await post(app, "activities", FIXTURE_ACTIVITY);
    expect((await post(app, "allocations", FIXTURE_ALLOCATION)).statusCode).toBe(201);
    expectFixture((await state(app)).allocations[0], FIXTURE_ALLOCATION);
  });

  it("timeOff: every field round-trips (including optional note)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    await post(app, "resources", FIXTURE_RESOURCE);
    expect((await post(app, "timeOff", FIXTURE_TIMEOFF)).statusCode).toBe(201);
    expectFixture((await state(app)).timeOff[0], FIXTURE_TIMEOFF);
  });
});
