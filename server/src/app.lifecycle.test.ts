import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createApp } from "./app";
import { openDb, insertAll, type CompleteAccountSlice, type Db, type ProjectedAccountSlice } from "./db";
import { upsertMember } from "./controlTables";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { createFileAuditSink, type AuditRecord } from "./audit";
import { PASSWORD_ENV, call, signUp } from "./testHelpers";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import {
  emptyAppData,
  type AppData,
  type Client,
  type Project,
  type Resource,
} from "@capacitylens/shared/types/entities";
import { registerLifecycleRoutes } from "./routes/lifecycleRoutes";
import { ACCOUNT_SESSION_FRESH_AGE_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import type { TenantStore } from "./tenantStore";

// P2.5a entity-lifecycle routes — the SERVER half of the Active→Archived→Soft-deleted→Purged machine.
// This suite drives the four dedicated action routes (archive/unarchive/delete/purge) + the
// `?includeInactive=1` admin read END-TO-END (sign-up → membership → request) and asserts the resulting
// status codes, the server-enforced interlocks (409s), the purge cascade, the persisted resource
// obfuscation (P2.3 carry-forward) and the built-in-Internal-client guard. The pure transitions
// themselves are unit-tested in shared/domain/lifecycle.test.ts; here we prove the WIRING:
// authorize tiers, owned targeted writes and the audit line.

const TS = "2026-01-01T00:00:00.000Z";
const meta = () => ({ createdAt: TS, updatedAt: TS });

const account = (id: string) => ({
  id,
  name: `Studio ${id}`,
  color: "#3b82f6",
  ...meta(),
});
const client = (id: string, accountId: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId,
  name: "Acme",
  color: "#3b82f6",
  ...meta(),
  ...extra,
});

interface ProjectInput {
  id: string;
  accountId: string;
  clientId: string;
  extra?: Record<string, unknown> | undefined;
}

const project = ({ id, accountId, clientId, extra = {} }: ProjectInput) => ({
  id,
  accountId,
  name: "Web",
  clientId,
  color: "#3b82f6",
  ...meta(),
  ...extra,
});
const person = (id: string, accountId: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId,
  kind: "person",
  name: "Pat Designer",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#3b82f6",
  ...meta(),
  ...extra,
});
const phase = (id: string, accountId: string, projectId: string) => ({
  id,
  accountId,
  name: "Phase 1",
  projectId,
  ...meta(),
});

interface ActivityInput {
  id: string;
  accountId: string;
  projectId: string;
  phaseId: string;
}

const activity = ({ id, accountId, projectId, phaseId }: ActivityInput) => ({
  id,
  accountId,
  name: "Build",
  kind: "project",
  projectId,
  phaseId,
  ...meta(),
});

interface AllocationInput {
  id: string;
  accountId: string;
  resourceId: string;
  activityId: string;
}

const allocation = ({ id, accountId, resourceId, activityId }: AllocationInput) => ({
  id,
  accountId,
  resourceId,
  activityId,
  startDate: "2026-02-01",
  endDate: "2026-02-05",
  hoursPerDay: 6,
  status: "confirmed",
  ...meta(),
});

// A 31-day-old soft-delete tombstone: aged just past PURGE_MIN_AGE_DAYS (30) so canPurge passes. The
// archivedAt precedes it (soft-delete requires prior archival), but deletedAt WINS for the state read.
const THIRTY_ONE_DAYS_AGO = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
const archivedTombstone = { archivedAt: TS, deletedAt: THIRTY_ONE_DAYS_AGO };
const justArchived = { archivedAt: TS };

it("rolls a lifecycle transition back when response redaction fails", async () => {
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("preHandler", (req, _reply, done) => {
    req.user = {
      id: "demo",
      email: "demo@example.com",
      emailVerified: true,
      name: "Demo",
      image: null,
    };
    done();
  });
  let data = {
    ...emptyAppData(),
    accounts: [account("a1")],
    resources: [person("r1", "a1")],
  } as AppData;
  const store: TenantStore = {
    readSlice: () => data as ProjectedAccountSlice,
    readFullSlice: () => data as CompleteAccountSlice,
    readLifecycleRow: (accountId, entity, id) =>
      (data[entity] as Array<Resource | Client | Project>).find(
        (row) => row.id === id && row.accountId === accountId,
      ) ?? null,
    writeLifecycleRow: (accountId, entity, row) => {
      data = {
        ...data,
        [entity]: (data[entity] as Array<Resource | Client | Project>).map((current) =>
          current.id === row.id && current.accountId === accountId ? row : current,
        ),
      };
    },
    scrubResourceNotes: () => ({ allocationNotes: false, timeOffNotes: false }),
    purgeLifecycleRow: () => null,
  };
  registerLifecycleRoutes(app, {
    store,
    authorize: () => true,
    commit: (_reply, _record, mutation) => {
      const before = data;
      try {
        mutation();
      } catch (error) {
        data = before;
        throw error;
      }
    },
    fail: (reply) => reply.code(500).send({ error: "redaction failed" }),
    redact: () => {
      throw new Error("redaction failed");
    },
  });

  const response = await lifecycleAction({ app, entity: "resources", id: "r1", action: "archive", accountId: "a1" });

  expect(response.statusCode).toBe(500);
  expect(data.resources[0]).not.toHaveProperty("archivedAt");
  await app.close();
});

/** Build an auth-on (password) app over a fresh in-memory DB, returning both so the test can seed. */
async function appWithAuth(
  securityLog?: (event: Record<string, unknown>) => void,
): Promise<{ app: FastifyInstance; db: Db }> {
  const db = openDb(":memory:");
  const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!auth) throw new Error("Expected password authentication to be configured.");
  await runAuthMigrations(auth);
  return {
    app: createApp(db, { authMode: mode, auth, ...(securityLog === undefined ? {} : { securityLog }) }),
    db,
  };
}

interface LifecycleActionInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  action: "archive" | "unarchive" | "delete" | "purge";
  accountId: string;
  cookie?: string | undefined;
}

// ---- Lifecycle action requests (cookie carries the session in auth-on; omit it for OFF). ----

const lifecycleAction = ({ app, entity, id, action, accountId, cookie }: LifecycleActionInput) =>
  call(app, {
    method: "POST",
    url: `/api/${entity}/${id}/${action}`,
    payload: { accountId },
    headers: cookie ? { cookie } : {},
  });

const readInactive = (app: FastifyInstance, accountId: string, cookie?: string) =>
  call(app, {
    method: "GET",
    url: `/api/state?accountId=${accountId}&includeInactive=1`,
    headers: cookie ? { cookie } : {},
  });

interface ErrorResponseBody {
  code: string | undefined;
  error: string;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readErrorResponseBody(response: unknown): ErrorResponseBody {
  if (!isUnknownRecord(response) || typeof response.body !== "string") {
    throw new Error("Expected a lifecycle response.");
  }
  const body: unknown = JSON.parse(response.body);
  if (
    !isUnknownRecord(body) ||
    typeof body.error !== "string" ||
    (body.code !== undefined && typeof body.code !== "string")
  ) {
    throw new Error("Expected a lifecycle error response body.");
  }
  return { code: body.code, error: body.error };
}

interface LifecycleStateIds {
  clients: string[];
  projects: string[];
  phases: string[];
  activities: string[];
  allocations: string[];
  resources: string[];
}

function readEntityIds(body: Record<string, unknown>, entity: keyof LifecycleStateIds): string[] {
  const rows = body[entity];
  if (!Array.isArray(rows)) {
    throw new Error(`Expected lifecycle state ${entity} rows.`);
  }
  return rows.map((row) => {
    if (!isUnknownRecord(row) || typeof row.id !== "string") {
      throw new Error(`Expected lifecycle state ${entity} rows with string ids.`);
    }
    return row.id;
  });
}

function readResponseBodyRecord(response: unknown): Record<string, unknown> {
  if (!isUnknownRecord(response) || typeof response.body !== "string") {
    throw new Error("Expected a lifecycle response.");
  }
  const body: unknown = JSON.parse(response.body);
  if (!isUnknownRecord(body)) {
    throw new Error("Expected a lifecycle state response body.");
  }
  return body;
}

function readLifecycleStateIds(response: unknown): LifecycleStateIds {
  const body = readResponseBodyRecord(response);
  return {
    clients: readEntityIds(body, "clients"),
    projects: readEntityIds(body, "projects"),
    phases: readEntityIds(body, "phases"),
    activities: readEntityIds(body, "activities"),
    allocations: readEntityIds(body, "allocations"),
    resources: readEntityIds(body, "resources"),
  };
}

interface SurvivorResource {
  id: string;
  updatedAt: string;
  projectId?: string;
}

interface SurvivorState {
  projectIds: string[];
  resources: SurvivorResource[];
}

function readSurvivorState(response: unknown): SurvivorState {
  const body = readResponseBodyRecord(response);
  const resources = body.resources;
  if (!Array.isArray(resources)) {
    throw new Error("Expected lifecycle state resource rows.");
  }
  return {
    projectIds: readEntityIds(body, "projects"),
    resources: resources.map((resource) => {
      if (
        !isUnknownRecord(resource) ||
        typeof resource.id !== "string" ||
        typeof resource.updatedAt !== "string" ||
        (resource.projectId !== undefined && typeof resource.projectId !== "string")
      ) {
        throw new Error("Expected lifecycle survivor resources with valid revisions and project ids.");
      }
      return {
        id: resource.id,
        updatedAt: resource.updatedAt,
        ...(resource.projectId === undefined ? {} : { projectId: resource.projectId }),
      };
    }),
  };
}

interface DeletedResourceResponse {
  name: string;
  deletedAt: string;
  archivedAt: string;
}

interface DeletedRevisionResponse {
  archivedAt: string;
  deletedAt: string;
  updatedAt: string;
}

function readDeletedResource(value: unknown): DeletedResourceResponse {
  if (
    !isUnknownRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.deletedAt !== "string" ||
    typeof value.archivedAt !== "string"
  ) {
    throw new Error("Expected a deleted lifecycle resource.");
  }
  return { name: value.name, deletedAt: value.deletedAt, archivedAt: value.archivedAt };
}

function readDeletedResourceResponse(response: unknown): DeletedResourceResponse {
  return readDeletedResource(readResponseBodyRecord(response));
}

function readDeletedRevisionResponse(response: unknown): DeletedRevisionResponse {
  const body = readResponseBodyRecord(response);
  return {
    archivedAt: readRequiredString(body, "archivedAt"),
    deletedAt: readRequiredString(body, "deletedAt"),
    updatedAt: readRequiredString(body, "updatedAt"),
  };
}

function readEntityRecord(body: Record<string, unknown>, entity: string, id: string): Record<string, unknown> {
  const rows = body[entity];
  if (!Array.isArray(rows)) {
    throw new Error(`Expected lifecycle state ${entity} rows.`);
  }
  for (const row of rows) {
    const candidate: unknown = row;
    if (isUnknownRecord(candidate) && candidate.id === id) {
      return candidate;
    }
  }
  throw new Error(`Expected lifecycle state ${entity} row ${id}.`);
}

function readRequiredString(record: Record<string, unknown>, property: string): string {
  const value = record[property];
  if (typeof value !== "string") {
    throw new Error(`Expected lifecycle state ${property} to be a string.`);
  }
  return value;
}

function readDependentNote(
  db: Db,
  table: "allocations" | "timeOff",
  id: string,
): { note: string | null; updatedAt: string } {
  const row: unknown = db.prepare(`SELECT note, updatedAt FROM ${table} WHERE id = ?`).get(id);
  if (!isUnknownRecord(row)) throw new Error(`Expected dependent ${table} row ${id}.`);
  const note = row.note;
  const updatedAt = row.updatedAt;
  if ((note !== null && typeof note !== "string") || typeof updatedAt !== "string") {
    throw new Error(`Expected dependent ${table} row ${id} note and revision.`);
  }
  return { note, updatedAt };
}

async function submitDescendantWrites(app: FastifyInstance) {
  const beneathArchivedProject = await call(app, {
    method: "POST",
    url: "/api/phases",
    payload: phase("ph-new", "a1", "p-archived"),
  });
  const beneathDeletedClient = await call(app, {
    method: "POST",
    url: "/api/activities",
    payload: activity({
      id: "act-new",
      accountId: "a1",
      projectId: "p-under-deleted-client",
      phaseId: "ph-existing",
    }),
  });
  const updateBeneathDeletedClient = await call(app, {
    method: "PATCH",
    url: "/api/phases/ph-existing",
    payload: { name: "Invisible update" },
  });
  const updateBeneathArchivedProject = await call(app, {
    method: "PATCH",
    url: "/api/phases/ph-under-archived",
    payload: { name: "Invisible immediate-parent update" },
  });
  const updatePlaceholderBeneathDeletedProject = await call(app, {
    method: "PATCH",
    url: "/api/resources/placeholder-under-deleted-project",
    payload: { role: "Invisible placeholder update" },
  });
  return {
    beneathArchivedProject,
    beneathDeletedClient,
    updateBeneathDeletedClient,
    updateBeneathArchivedProject,
    updatePlaceholderBeneathDeletedProject,
  };
}

const SENTINEL_NAME = "SENTINEL_PERSON_NAME_XYZ";

function registerSentinelObfuscationTest(): void {
  it("archive→delete a resource scrubs name server-side; sentinel appears nowhere in the read body", async () => {
    const { app, db } = await appWithAuth();
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.resources = [person("rSent", "a1", { name: SENTINEL_NAME })];
    insertAll(db, d as unknown as AppData);

    const { cookie, userId } = await signUp(app, "obfuscate@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rSent", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(200);
    const del = await lifecycleAction({
      app,
      entity: "resources",
      id: "rSent",
      action: "delete",
      accountId: "a1",
      cookie,
    });
    expect(del.statusCode).toBe(200);
    expect(readDeletedResourceResponse(del).name).toMatch(/^Removed person #/);
    expect(del.body).not.toContain(SENTINEL_NAME);

    const after = await readInactive(app, "a1", cookie);
    expect(after.statusCode).toBe(200);
    const row = readDeletedResourceState(after, "rSent");
    expect(row.name).toMatch(/^Removed person #/);
    expect(row.deletedAt).toBeTruthy();
    expect(row.archivedAt).toBeTruthy();
    expect(after.body).not.toContain(SENTINEL_NAME);
  });
}

function readDeletedResourceState(response: unknown, id: string): DeletedResourceResponse {
  const resource = readEntityRecord(readResponseBodyRecord(response), "resources", id);
  return readDeletedResource(resource);
}

// One built-in Internal client whose id is captured so the built-in-guard test can target it (its id is
// random per buildInternalClient call, so it MUST be built once and reused — not rebuilt at assert time).
const INTERNAL = buildInternalClient("a1", TS);

/**
 * Seed one account a1 with a client/project/resource in each of the states a test needs:
 *  - c1/p1/r1: ACTIVE  (archive/delete-interlock subjects)
 *  - cArc/pArc/rArc: ARCHIVED (unarchive/delete subjects)
 *  - rDel: a soft-delete TOMBSTONE aged 31 days (purge-eligible)
 *  - rYoung: a soft-delete tombstone aged 0 days (purge-too-young → 409)
 *  - INTERNAL: the built-in Internal client (builtin:true)
 * a2 carries c2 so cross-tenant tests have a foreign target.
 */
function seedStates(db: Db): void {
  const d = emptyAppData() as unknown as Record<string, unknown[]>;
  d.accounts = [account("a1"), account("a2")];
  d.clients = [client("c1", "a1"), client("cArc", "a1", justArchived), INTERNAL, client("c2", "a2")];
  d.projects = [
    project({ id: "p1", accountId: "a1", clientId: "c1" }),
    project({ id: "pArc", accountId: "a1", clientId: "c1", extra: justArchived }),
  ];
  d.resources = [
    person("r1", "a1"),
    person("rArc", "a1", justArchived),
    person("rDel", "a1", archivedTombstone),
    person("rYoung", "a1", {
      archivedAt: TS,
      deletedAt: new Date().toISOString(),
    }),
  ];
  insertAll(db, d as unknown as AppData);
}

describe("P2.5a lifecycle — auth-on 403 permission matrix", () => {
  it("viewer of a1: archive/unarchive/delete/purge AND read-inactive → 403", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "viewer-lc@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "viewer",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "cArc", action: "unarchive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rArc", action: "delete", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rDel", action: "purge", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect((await readInactive(app, "a1", cookie)).statusCode).toBe(403);
  });

  it("editor of a1: archive/unarchive → 2xx; irreversible delete/purge and read-inactive → 403", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "editor-lc@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "cArc", action: "unarchive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rArc", action: "delete", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    // delete and purge are admin+ because neither has an undelete transition.
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rDel", action: "purge", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect((await readInactive(app, "a1", cookie)).statusCode).toBe(403);
  });

  it.each(["admin", "owner"] as const)("%s of a1: every lifecycle route + read-inactive → 2xx", async (role) => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, `${role}-lc@capacitylens.dev`);
    upsertMember(db, {
      accountId: "a1",
      userId,
      role,
      status: "active",
      createdAt: TS,
    });

    expect(
      (await lifecycleAction({ app, entity: "projects", id: "p1", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "projects", id: "pArc", action: "unarchive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rArc", action: "delete", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rDel", action: "purge", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(204);
    expect((await readInactive(app, "a1", cookie)).statusCode).toBe(200);
  });

  it("non-member (signed in, no membership): every lifecycle route + read-inactive → 403", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie } = await signUp(app, "stranger-lc@capacitylens.dev"); // NO membership

    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "cArc", action: "unarchive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rArc", action: "delete", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rDel", action: "purge", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(403);
    expect((await readInactive(app, "a1", cookie)).statusCode).toBe(403);
  });

  it("requires a fresh admin session for read-inactive while ordinary state remains readable", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { app, db } = await appWithAuth((event) => events.push(event));
    seedStates(db);
    const { cookie, userId } = await signUp(app, "stale-admin-lc@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    db.prepare(`UPDATE session SET createdAt = ? WHERE userId = ?`).run(
      new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      userId,
    );

    const ordinary = await call(app, {
      method: "GET",
      url: "/api/state?accountId=a1",
      headers: { cookie },
    });
    expect(ordinary.statusCode).toBe(200);

    const inactive = await readInactive(app, "a1", cookie);
    expect(inactive.statusCode).toBe(403);
    expect(inactive.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "step_up_required",
        outcome: "blocked",
        action: "purge",
        accountId: "a1",
        userId,
      }),
    );
  });

  // The freshness deadline is INCLUSIVE (`>=` in authorize()): a session exactly at the bound is
  // stale. The bound is pinned here at millisecond precision — the coarse 16-minute test above
  // proves the wiring, these prove the operator.
  it.each([
    ["one millisecond inside the freshness window", ACCOUNT_SESSION_FRESH_AGE_SECONDS * 1000 - 1, 200],
    ["exactly at the freshness deadline", ACCOUNT_SESSION_FRESH_AGE_SECONDS * 1000, 403],
    ["one millisecond past the freshness deadline", ACCOUNT_SESSION_FRESH_AGE_SECONDS * 1000 + 1, 403],
  ] as const)("treats an admin session aged %s as status %s for read-inactive", async (_label, age, status) => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, `fresh-boundary-${age}@capacitylens.dev`);
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });
    // Pin the clock AFTER sign-up so the session's updatedAt (written at real time) is never in
    // the pinned clock's future, then age createdAt to the exact boundary under test.
    const now = Date.now();
    db.prepare(`UPDATE session SET createdAt = ? WHERE userId = ?`).run(new Date(now - age).toISOString(), userId);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const res = await readInactive(app, "a1", cookie);
      expect(res.statusCode).toBe(status);
      if (status === 403) expect(res.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("P2.5a lifecycle — interlock 409s (illegal transitions / preconditions)", () => {
  it("delete on an ACTIVE row → 409 (must be archived first)", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-delete-active@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({
      app,
      entity: "resources",
      id: "r1",
      action: "delete",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    const body = readErrorResponseBody(res);
    expect(body.code).toBe("invalid_transition");
    expect(body.error).toMatch(/must be archived first/);
  });

  it("archive on an already-archived row → 409", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-arc-arc@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({
      app,
      entity: "clients",
      id: "cArc",
      action: "archive",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    const body = readErrorResponseBody(res);
    expect(body.code).toBe("already_inactive");
    expect(body.error).toMatch(/already archived/);
  });

  it("unarchive on an ACTIVE row → 409 (nothing to undo)", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-unarc-active@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({
      app,
      entity: "clients",
      id: "c1",
      action: "unarchive",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    const body = readErrorResponseBody(res);
    expect(body.code).toBe("invalid_transition");
    expect(body.error).toMatch(/not archived/);
  });

  it("purge on a tombstone aged < 30 days → 409", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-purge-young@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({
      app,
      entity: "resources",
      id: "rYoung",
      action: "purge",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    expect(readErrorResponseBody(res).error).toMatch(/at least 30 days old/);
  });

  it("purge on a NON-tombstone (archived) row → 409", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-purge-archived@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({
      app,
      entity: "resources",
      id: "rArc",
      action: "purge",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    expect(readErrorResponseBody(res).error).toMatch(/soft-deleted tombstone/);
  });

  it("unarchive on a soft-deleted tombstone → 409 (a tombstone must not resurrect to active)", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-unarc-tombstone@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    // rDel is a soft-delete tombstone (deletedAt set). Unarchive accepts archived rows ONLY, so clearing
    // archivedAt here would leave the tombstone still 'deleted' — the transition refuses outright.
    const res = await lifecycleAction({
      app,
      entity: "resources",
      id: "rDel",
      action: "unarchive",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    expect(readErrorResponseBody(res).error).toMatch(/not archived/);
  });

  it("unarchives and repairs an archived legacy row with a malformed deletion tombstone", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    db.prepare(`UPDATE resources SET deletedAt = ? WHERE id = ?`).run("not-a-date", "rArc");
    const { cookie, userId } = await signUp(app, "il-unarc-malformed@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "editor",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({
      app,
      entity: "resources",
      id: "rArc",
      action: "unarchive",
      accountId: "a1",
      cookie,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("archivedAt");
    expect(res.json()).not.toHaveProperty("deletedAt");
    expect(db.prepare(`SELECT archivedAt, deletedAt FROM resources WHERE id = ?`).get("rArc")).toEqual({
      archivedAt: null,
      deletedAt: null,
    });
  });

  it("delete on a soft-deleted tombstone → 409 (no re-delete; softDelete requires archived)", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-redelete-tombstone@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    // rDel already reads 'deleted'; softDelete requires 'archived', so a re-delete is a 409, not a no-op.
    const res = await lifecycleAction({
      app,
      entity: "resources",
      id: "rDel",
      action: "delete",
      accountId: "a1",
      cookie,
    });
    expect(res.statusCode).toBe(409);
    expect(readErrorResponseBody(res).error).toMatch(/must be archived first/);
  });

  it("unknown lifecycle entity → 404; missing accountId → 400; missing row → 404", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "il-shape@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    // 'phases' is scoped but carries NO lifecycle tombstone → 404 on a lifecycle route.
    expect(
      (await lifecycleAction({ app, entity: "phases", id: "x", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(404);
    // missing accountId in the body → 400.
    const noAcct = await call(app, {
      method: "POST",
      url: "/api/clients/c1/archive",
      payload: {},
      headers: { cookie },
    });
    expect(noAcct.statusCode).toBe(400);
    // a row that isn't there → 404 (after authorize passes).
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "nope", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(404);
  });
});

describe("P2.5a lifecycle — purge cascade removes the row + its descendants", () => {
  it("purging a tombstoned client removes its projects/phases/activities/allocations", async () => {
    const { app, db } = await appWithAuth();
    // Seed a client with a full subtree (project → phase → activity → allocation) AND an aged tombstone
    // on the client, so it is purge-eligible without going through archive→delete here.
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.clients = [client("cTree", "a1", archivedTombstone)];
    d.projects = [project({ id: "pTree", accountId: "a1", clientId: "cTree" })];
    d.phases = [phase("phTree", "a1", "pTree")];
    d.activities = [activity({ id: "actTree", accountId: "a1", projectId: "pTree", phaseId: "phTree" })];
    d.resources = [person("rTree", "a1")];
    d.allocations = [allocation({ id: "alTree", accountId: "a1", resourceId: "rTree", activityId: "actTree" })];
    insertAll(db, d as unknown as AppData);

    const { cookie, userId } = await signUp(app, "cascade@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await lifecycleAction({ app, entity: "clients", id: "cTree", action: "purge", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(204);

    // Read the FULL (admin) slice and confirm the client AND its whole subtree are GONE.
    const after = await readInactive(app, "a1", cookie);
    expect(after.statusCode).toBe(200);
    const ids = readLifecycleStateIds(after);
    expect(ids.clients).not.toContain("cTree");
    expect(ids.projects).not.toContain("pTree");
    expect(ids.phases).not.toContain("phTree");
    expect(ids.activities).not.toContain("actTree");
    expect(ids.allocations).not.toContain("alTree");
    // The resource itself is unbound, not deleted (the cascade only drops the activity's allocations).
    expect(ids.resources).toContain("rTree");
  });
});

describe("P2.5a lifecycle — purge stamps the survivor rows the cascade unbinds", () => {
  interface PlaceholderInput {
    id: string;
    accountId: string;
    projectId?: string | undefined;
    extra?: Record<string, unknown> | undefined;
  }

  // The web store's purgeEntity passes nextDataRevision so a survivor whose FK is cleared (a
  // placeholder unbound from the purged project) gets a fresh updatedAt. The server MUST match:
  // without it the survivor keeps its old updatedAt, so a colleague's stale session passes the
  // optimistic-concurrency check yet fails referential validation with a 400 (not the 409 that drives
  // the server-wins reload) and persist.ts wedges behind a permanent save banner.
  const placeholder = ({ id, accountId, projectId, extra = {} }: PlaceholderInput) => ({
    ...person(id, accountId, extra),
    kind: "placeholder",
    projectId,
  });

  it("bumps an unbound placeholder to a fresh revision and leaves an unrelated row untouched", async () => {
    const { app, db } = await appWithAuth();
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    // A purge-eligible (aged tombstone) project, a placeholder BOUND to it, and an UNRELATED resource.
    d.clients = [client("c1", "a1")];
    d.projects = [project({ id: "pBound", accountId: "a1", clientId: "c1", extra: archivedTombstone })];
    const futureOffsetRevision = "2099-01-01T01:00:00+01:00";
    d.resources = [
      placeholder({ id: "phBound", accountId: "a1", projectId: "pBound", extra: { updatedAt: futureOffsetRevision } }),
      person("rFree", "a1"),
    ];
    insertAll(db, d as unknown as AppData);

    const { cookie, userId } = await signUp(app, "survivor@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    expect(
      (await lifecycleAction({ app, entity: "projects", id: "pBound", action: "purge", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(204);

    const state = readSurvivorState(await readInactive(app, "a1", cookie));
    expect(state.projectIds).not.toContain("pBound");
    const phBound = state.resources.find((resource) => resource.id === "phBound");
    if (!phBound) throw new Error("Expected the unbound placeholder to survive the purge.");
    // Survivor: unbound from the purged project AND re-stamped after its future, non-canonical
    // offset revision. This proves purge ordering is chronological rather than lexical.
    expect(phBound.projectId ?? null).toBeNull();
    expect(Date.parse(phBound.updatedAt)).toBeGreaterThan(Date.parse(futureOffsetRevision));
    // Untouched by the cascade → its revision must NOT be gratuitously bumped.
    const rFree = state.resources.find((resource) => resource.id === "rFree");
    if (!rFree) throw new Error("Expected the unrelated resource to survive the purge.");
    expect(rFree.updatedAt).toBe(TS);
  });
});

describe("P2.5a lifecycle — resource soft-delete obfuscation persists (P2.3 carry-forward)", () => {
  registerSentinelObfuscationTest();

  it("re-stamps only dependent rows whose notes are scrubbed, without moving future revisions backwards", async () => {
    const futureRevision = "2099-01-01T00:00:00.000Z";
    const db = openDb(":memory:");
    const app = createApp(db, { optimisticConcurrency: false });
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.resources = [person("rNotes", "a1", justArchived)];
    d.clients = [client("c1", "a1")];
    d.projects = [project({ id: "p1", accountId: "a1", clientId: "c1" })];
    d.phases = [phase("ph1", "a1", "p1")];
    d.activities = [activity({ id: "act1", accountId: "a1", projectId: "p1", phaseId: "ph1" })];
    d.allocations = [
      {
        ...allocation({ id: "alNoted", accountId: "a1", resourceId: "rNotes", activityId: "act1" }),
        note: "private",
        updatedAt: futureRevision,
      },
      allocation({ id: "alPlain", accountId: "a1", resourceId: "rNotes", activityId: "act1" }),
    ];
    d.timeOff = [
      {
        id: "toNoted",
        accountId: "a1",
        resourceId: "rNotes",
        startDate: "2026-02-01",
        endDate: "2026-02-02",
        type: "holiday",
        note: "private",
        ...meta(),
        updatedAt: futureRevision,
      },
      {
        id: "toPlain",
        accountId: "a1",
        resourceId: "rNotes",
        startDate: "2026-02-03",
        endDate: "2026-02-04",
        type: "holiday",
        ...meta(),
      },
    ];
    insertAll(db, d as unknown as AppData);

    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rNotes", action: "delete", accountId: "a1" })).statusCode,
    ).toBe(200);

    expect(readDependentNote(db, "allocations", "alNoted")).toEqual({
      note: null,
      updatedAt: "2099-01-01T00:00:00.001Z",
    });
    expect(readDependentNote(db, "allocations", "alPlain")).toEqual({ note: null, updatedAt: TS });
    expect(readDependentNote(db, "timeOff", "toNoted")).toEqual({
      note: null,
      updatedAt: "2099-01-01T00:00:00.001Z",
    });
    expect(readDependentNote(db, "timeOff", "toPlain")).toEqual({ note: null, updatedAt: TS });
  });
});

describe("P2.5a lifecycle — built-in Internal client cannot be archived/deleted/purged", () => {
  it.each(["archive", "delete", "purge"] as const)("%s on the built-in Internal client → 409", async (action) => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, `builtin-${action}@capacitylens.dev`);
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    const res = await lifecycleAction({ app, entity: "clients", id: INTERNAL.id, action, accountId: "a1", cookie });
    expect(res.statusCode).toBe(409);
    const body = readErrorResponseBody(res);
    expect(body.code).toBe("protected_entity");
    expect(body.error).toMatch(/built-in Internal client/);
  });
});

describe("P2.5a lifecycle — OFF mode is allow-all (the #1 invariant)", () => {
  function offApp(): { app: FastifyInstance; db: Db } {
    const db = openDb(":memory:");
    const app = createApp(db, { optimisticConcurrency: false });
    seedStates(db);
    return { app, db };
  }

  it("every lifecycle route + read-inactive succeeds with NO auth cookie", async () => {
    const { app } = offApp();
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "cArc", action: "unarchive", accountId: "a1" })).statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rArc", action: "delete", accountId: "a1" })).statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rDel", action: "purge", accountId: "a1" })).statusCode,
    ).toBe(204);
    expect((await readInactive(app, "a1")).statusCode).toBe(200);
  });

  it("advances a deletion revision past a future archive timestamp", async () => {
    const futureArchive = "2099-01-01T00:00:00.000Z";
    const db = openDb(":memory:");
    const app = createApp(db, { optimisticConcurrency: false });
    insertAll(db, {
      ...emptyAppData(),
      accounts: [account("a1")],
      clients: [client("future-archive", "a1", { archivedAt: futureArchive })],
    });

    const response = await lifecycleAction({
      app,
      entity: "clients",
      id: "future-archive",
      action: "delete",
      accountId: "a1",
    });
    expect(response.statusCode).toBe(200);
    const deleted = readDeletedRevisionResponse(response);
    expect(deleted.deletedAt >= futureArchive).toBe(true);
    expect(deleted.updatedAt >= deleted.deletedAt).toBe(true);
  });
});

describe("P2.5a lifecycle — cross-tenant: a1 member acting on a2 row → 403/404", () => {
  it("a member of a1 only → archiving a2 (asserting accountId=a2) → 403; asserting a1 over a2 id → 404", async () => {
    const { app, db } = await appWithAuth();
    seedStates(db);
    const { cookie, userId } = await signUp(app, "xtenant-lc@capacitylens.dev");
    upsertMember(db, {
      accountId: "a1",
      userId,
      role: "admin",
      status: "active",
      createdAt: TS,
    });

    // Claiming accountId=a2 (the row's real owner) → not a member of a2 → 403.
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c2", action: "archive", accountId: "a2", cookie }))
        .statusCode,
    ).toBe(403);
    // Claiming accountId=a1 (where they ARE a member) for a2's row id → the a1 slice has no such row → 404.
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c2", action: "archive", accountId: "a1", cookie }))
        .statusCode,
    ).toBe(404);
  });
});

describe("P2.5a lifecycle — targeted writes preserve unrelated siblings", () => {
  // Lifecycle routes update one owned row. Unrelated inactive rows and confidential notes must not
  // be rewritten as a side effect of that targeted operation.
  const TIMEOFF_NOTE = "PRESERVE_ME_TIMEOFF_NOTE_QPR";

  it("archiving one active row leaves an unrelated archived row, a tombstone, and a time-off note intact", async () => {
    const db = openDb(":memory:");
    const app = createApp(db); // OFF mode: allow-all, and the read returns the time-off note (includeTimeOffNote)
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.resources = [
      person("rActive", "a1"), // the mutation target (active → archived)
      person("rArc", "a1", justArchived), // UNRELATED already-archived sibling (archivedAt must survive)
      person("rDel", "a1", archivedTombstone), // UNRELATED soft-delete tombstone (deletedAt must survive)
    ];
    // A time-off row on the mutation target carries a note the lifecycle write must not touch.
    d.timeOff = [
      {
        id: "to1",
        accountId: "a1",
        resourceId: "rActive",
        startDate: "2026-03-02",
        endDate: "2026-03-06",
        type: "holiday",
        note: TIMEOFF_NOTE,
        ...meta(),
      },
    ];
    insertAll(db, d as unknown as AppData);

    // Mutate one active row through the owned lifecycle operation.
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rActive", action: "archive", accountId: "a1" }))
        .statusCode,
    ).toBe(200);

    // Admin read (includeInactive=1) so the inactive siblings are visible to assert against.
    const after = await readInactive(app, "a1");
    expect(after.statusCode).toBe(200);
    const body = readResponseBodyRecord(after);
    const resourceById = (id: string) => readEntityRecord(body, "resources", id);

    // (a) the unrelated archived sibling still carries its archivedAt.
    expect(readRequiredString(resourceById("rArc"), "archivedAt")).toBe(TS);
    // (b) the unrelated tombstone still carries its deletedAt.
    expect(readRequiredString(resourceById("rDel"), "deletedAt")).toBe(THIRTY_ONE_DAYS_AGO);
    // (c) the time-off note survives the unrelated lifecycle write.
    const timeOff = readEntityRecord(body, "timeOff", "to1");
    expect(readRequiredString(timeOff, "note")).toBe(TIMEOFF_NOTE);
  });
});

describe("P2.5a lifecycle — audit line (file sink, OFF mode)", () => {
  it('an archive emits one audit line: action "archive", changedFields ["archivedAt"], no value leak', async () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-lc-audit-"));
    const file = join(dir, "audit.jsonl");
    const db = openDb(":memory:");
    const app = createApp(db, { audit: createFileAuditSink(file, () => {}) });
    // A resource whose name is a sentinel — to prove the audit line carries the field NAME, not the value.
    const SENTINEL = "AUDIT_SENTINEL_NAME";
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.resources = [person("rA", "a1", { name: SENTINEL })];
    insertAll(db, d as unknown as AppData);

    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rA", action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);

    const lines = existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as AuditRecord)
      : [];
    expect(lines).toHaveLength(1);
    const rec = lines[0];
    if (!rec) throw new Error("Expected one lifecycle audit record.");
    expect(rec.action).toBe("archive");
    expect(rec.entity).toBe("resources");
    expect(rec.id).toBe("rA");
    expect(rec.accountId).toBe("a1");
    expect(rec.userId).toBe("demo"); // DEMO_USER in OFF mode
    expect(rec.changedFields).toEqual(["archivedAt"]);
    // No value leak: the sentinel name never reaches the audit line.
    expect(readFileSync(file, "utf8")).not.toContain(SENTINEL);
  });
});

describe("P2.5a lifecycle — audit line (file sink, OFF mode)", () => {
  it("a resource soft-delete audits its row and cascaded note scrubs without leaking values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-lc-audit-del-"));
    const file = join(dir, "audit.jsonl");
    const db = openDb(":memory:");
    const app = createApp(db, { audit: createFileAuditSink(file, () => {}) });
    // An ALREADY-ARCHIVED resource (delete requires prior archival) whose name is a unique sentinel —
    // the delete route both obfuscates the name AND audits 'name' as a field NAME; neither must leak the value.
    const SENTINEL = "AUDIT_DELETE_SENTINEL_NAME";
    const NOTE_SENTINEL = "AUDIT_DELETE_SENTINEL_NOTE";
    const d = emptyAppData() as unknown as Record<string, unknown[]>;
    d.accounts = [account("a1")];
    d.resources = [person("rDelAudit", "a1", { name: SENTINEL, ...justArchived })];
    d.clients = [client("c1", "a1")];
    d.projects = [project({ id: "p1", accountId: "a1", clientId: "c1" })];
    d.phases = [phase("ph1", "a1", "p1")];
    d.activities = [activity({ id: "act1", accountId: "a1", projectId: "p1", phaseId: "ph1" })];
    d.allocations = [
      {
        ...allocation({ id: "al1", accountId: "a1", resourceId: "rDelAudit", activityId: "act1" }),
        note: NOTE_SENTINEL,
      },
    ];
    d.timeOff = [
      {
        id: "to1",
        accountId: "a1",
        resourceId: "rDelAudit",
        startDate: "2026-02-01",
        endDate: "2026-02-02",
        type: "holiday",
        note: NOTE_SENTINEL,
        ...meta(),
      },
    ];
    insertAll(db, d as unknown as AppData);

    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rDelAudit", action: "delete", accountId: "a1" }))
        .statusCode,
    ).toBe(200);

    const lines = existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as AuditRecord)
      : [];
    expect(lines).toHaveLength(1);
    const rec = lines[0];
    if (!rec) throw new Error("Expected one lifecycle audit record.");
    expect(rec.action).toBe("softDelete");
    expect(rec.entity).toBe("resources");
    expect(rec.id).toBe("rDelAudit");
    expect(rec.accountId).toBe("a1");
    expect(rec.userId).toBe("demo"); // DEMO_USER in OFF mode
    // The audit carries the obfuscated field's NAME ('name'), never the scrubbed value.
    expect(rec.changedFields).toEqual(["deletedAt", "name", "allocations.note", "timeOff.note"]);
    // No value leak: the original (PII) name never reaches the audit line.
    expect(readFileSync(file, "utf8")).not.toContain(SENTINEL);
    expect(readFileSync(file, "utf8")).not.toContain(NOTE_SENTINEL);
  });
});

describe("P2.5a lifecycle — audit line (file sink, OFF mode)", () => {
  it("records privacy-safe per-table counts for an irreversible purge cascade", async () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-lc-audit-purge-"));
    const file = join(dir, "audit.jsonl");
    const db = openDb(":memory:");
    const app = createApp(db, { audit: createFileAuditSink(file, () => {}) });
    const SENTINEL = "PURGED_CUSTOMER_VALUE_MUST_NOT_APPEAR";
    const data = emptyAppData() as unknown as Record<string, unknown[]>;
    data.accounts = [account("a1")];
    data.clients = [client("cPurge", "a1", { ...archivedTombstone, name: SENTINEL })];
    data.projects = [project({ id: "pPurge", accountId: "a1", clientId: "cPurge" })];
    data.phases = [phase("phPurge", "a1", "pPurge")];
    data.activities = [activity({ id: "actPurge", accountId: "a1", projectId: "pPurge", phaseId: "phPurge" })];
    data.resources = [person("rSurvives", "a1")];
    data.allocations = [
      allocation({ id: "alPurge", accountId: "a1", resourceId: "rSurvives", activityId: "actPurge" }),
    ];
    insertAll(db, data as unknown as AppData);

    expect(
      (await lifecycleAction({ app, entity: "clients", id: "cPurge", action: "purge", accountId: "a1" })).statusCode,
    ).toBe(204);

    const record = JSON.parse(readFileSync(file, "utf8").trim()) as AuditRecord;
    expect(record).toMatchObject({
      action: "purge",
      entity: "clients",
      id: "cPurge",
      changedFields: [],
      cascadeCounts: {
        clients: 1,
        projects: 1,
        phases: 1,
        activities: 1,
        allocations: 1,
      },
    });
    expect(record.cascadeCounts).not.toHaveProperty("resources");
    expect(readFileSync(file, "utf8")).not.toContain(SENTINEL);
  });
});

describe("P2.1 write guards — generic writes cannot forge tombstones or un-flag the Internal client", () => {
  // Two integrity guards keeping the GENERIC write path (POST/PUT/PATCH/batch) from bypassing the
  // dedicated lifecycle routes: (1) sanitizeWrite PINS archivedAt/deletedAt to the stored row, so a
  // crafted body can neither SET a tombstone on an active row (skipping the archived-first interlock +
  // the resource-name PII scrub, and — with a back-dated deletedAt — making it instantly purgeable) NOR
  // CLEAR an existing one via an unrelated edit (which would silently RESURRECT an archived/soft-deleted
  // row — there is no un-delete route anywhere), and (2) validateWrite refuses to convert the built-in
  // Internal client back to a regular one. OFF mode is used (authorize is a no-op there), so these prove
  // the SANITIZE/VALIDATE layer itself, independent of the auth gate.

  const offAppWith = (data: Partial<Record<string, unknown[]>>): { app: FastifyInstance; db: Db } => {
    const db = openDb(":memory:");
    const app = createApp(db, { optimisticConcurrency: false });
    insertAll(db, { ...emptyAppData(), ...data } as unknown as AppData);
    return { app, db };
  };

  interface RowByIdInput {
    app: FastifyInstance;
    entity: "resources" | "clients";
    accountId: string;
    id: string;
  }

  const rowById = async ({ app, entity, accountId, id }: RowByIdInput) => {
    const res = await readInactive(app, accountId); // includeInactive so a (wrongly) tombstoned row still shows
    expect(res.statusCode).toBe(200);
    const body = readResponseBodyRecord(res);
    const rows = body[entity];
    if (!Array.isArray(rows)) throw new Error(`Expected lifecycle state ${entity} rows.`);
    return rows.find((row): row is Record<string, unknown> => isUnknownRecord(row) && row.id === id);
  };

  it("PATCH cannot set deletedAt/archivedAt on a resource (stripped; row stays active)", async () => {
    const { app } = offAppWith({
      accounts: [account("a1")],
      resources: [person("r1", "a1")],
    });
    const res = await call(app, {
      method: "PATCH",
      url: "/api/resources/r1",
      payload: {
        deletedAt: "2020-01-01T00:00:00.000Z",
        archivedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(200);
    const r1 = await rowById({ app, entity: "resources", accountId: "a1", id: "r1" });
    expect(r1?.deletedAt).toBeUndefined();
    expect(r1?.archivedAt).toBeUndefined();
    // Still ACTIVE: it appears in the DEFAULT (active-only) read too — the forged delete never took.
    const active = await call(app, {
      method: "GET",
      url: "/api/state?accountId=a1",
    });
    expect(readEntityIds(readResponseBodyRecord(active), "resources")).toContain("r1");
  });

  it("PUT cannot set deletedAt on a client (stripped)", async () => {
    const { app } = offAppWith({
      accounts: [account("a1")],
      clients: [client("c1", "a1")],
    });
    const res = await call(app, {
      method: "PUT",
      url: "/api/clients/c1",
      payload: client("c1", "a1", { deletedAt: "2020-01-01T00:00:00.000Z" }),
    });
    expect(res.statusCode).toBe(200);
    expect((await rowById({ app, entity: "clients", accountId: "a1", id: "c1" }))?.deletedAt).toBeUndefined();
  });

  it("PATCH {builtin:false} on the Internal client → 400 (cannot un-flag the singleton)", async () => {
    const { app } = offAppWith({
      accounts: [account("a1")],
      clients: [INTERNAL, client("c1", "a1")],
    });
    const res = await call(app, {
      method: "PATCH",
      url: `/api/clients/${INTERNAL.id}`,
      payload: { builtin: false },
    });
    expect(res.statusCode).toBe(400);
    // The flag survived — the singleton is intact.
    expect((await rowById({ app, entity: "clients", accountId: "a1", id: INTERNAL.id }))?.builtin).toBe(true);
    // A regular client still updates normally (control — the guard is surgical, not a blanket clients lock).
    const ok = await call(app, {
      method: "PATCH",
      url: "/api/clients/c1",
      payload: { name: "Renamed" },
    });
    expect(ok.statusCode).toBe(200);
  });

  // The OTHER direction of the pin (regression: the strip used to be blind, so an unrelated edit on a
  // tombstoned row NULLed the tombstone and resurrected the row). archive/delete set the tombstone via
  // the dedicated route; a subsequent generic edit must leave it intact.
  it("PATCH of an unrelated field on an ARCHIVED resource preserves the tombstone (no resurrection)", async () => {
    const { app } = offAppWith({
      accounts: [account("a1")],
      resources: [person("r1", "a1")],
    });
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "r1", action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);
    // Edit an unrelated field — the body never mentions archivedAt, but the merge spreads the stored
    // tombstone, and a blind strip would clear it. The pin keeps it.
    const res = await call(app, {
      method: "PATCH",
      url: "/api/resources/r1",
      payload: { role: "Senior Designer" },
    });
    expect(res.statusCode).toBe(200);
    const r1 = await rowById({ app, entity: "resources", accountId: "a1", id: "r1" });
    expect(typeof r1?.archivedAt).toBe("string"); // tombstone survived the edit
    expect(r1?.role).toBe("Senior Designer"); // the legit field DID change
    // Still ARCHIVED: absent from the DEFAULT (active-only) read — it was NOT resurrected.
    const active = await call(app, {
      method: "GET",
      url: "/api/state?accountId=a1",
    });
    expect(readEntityIds(readResponseBodyRecord(active), "resources")).not.toContain("r1");
  });

  it("rejects a generic PATCH of a soft-deleted client", async () => {
    const { app } = offAppWith({
      accounts: [account("a1")],
      clients: [client("c1", "a1")],
    });
    // archived-first interlock, then soft-delete: the row now carries deletedAt (and archivedAt).
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "delete", accountId: "a1" })).statusCode,
    ).toBe(200);
    const before = await rowById({ app, entity: "clients", accountId: "a1", id: "c1" });
    expect(typeof before?.deletedAt).toBe("string"); // really soft-deleted

    const res = await call(app, {
      method: "PATCH",
      url: "/api/clients/c1",
      payload: { color: "#da2d92" },
    });
    expect(res.statusCode).toBe(400);
    const after = await rowById({ app, entity: "clients", accountId: "a1", id: "c1" });
    expect(after?.deletedAt).toBe(before?.deletedAt); // soft-delete tombstone intact
    expect(after?.archivedAt).toBe(before?.archivedAt); // archive tombstone intact
    expect(after?.color).toBe(before?.color);
    // Still DELETED: absent from the DEFAULT (active-only) read — not resurrected.
    const active = await call(app, {
      method: "GET",
      url: "/api/state?accountId=a1",
    });
    expect(readEntityIds(readResponseBodyRecord(active), "clients")).not.toContain("c1");
  });

  it("rejects replacing the generated Internal client with a soft-deleted legacy row", async () => {
    const legacy = client("legacy-internal", "a1");
    const { app } = offAppWith({
      accounts: [account("a1")],
      clients: [INTERNAL, legacy],
    });
    expect(
      (await lifecycleAction({ app, entity: "clients", id: legacy.id, action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "clients", id: legacy.id, action: "delete", accountId: "a1" })).statusCode,
    ).toBe(200);

    const replacement = { ...buildInternalClient("a1", TS), id: legacy.id };
    const res = await call(app, {
      method: "PUT",
      url: `/api/clients/${legacy.id}`,
      payload: replacement,
    });

    expect(res.statusCode).toBe(400);
    expect(readRequiredString(readResponseBodyRecord(res), "error")).toMatch(/remain active/i);
    expect((await rowById({ app, entity: "clients", accountId: "a1", id: INTERNAL.id }))?.builtin).toBe(true);
    const retainedLegacy = await rowById({ app, entity: "clients", accountId: "a1", id: legacy.id });
    expect(retainedLegacy?.builtin).toBeUndefined();
    expect(typeof retainedLegacy?.deletedAt).toBe("string");
  });

  it("atomically rejects a batch replacement built from an archived legacy row", async () => {
    const legacy = client("legacy-internal", "a1");
    const ordinary = client("ordinary", "a1");
    const { app } = offAppWith({
      accounts: [account("a1")],
      clients: [INTERNAL, legacy, ordinary],
    });
    expect(
      (await lifecycleAction({ app, entity: "clients", id: legacy.id, action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);

    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: {
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: ordinary.id,
            row: { ...ordinary, name: "Must roll back" },
          },
          {
            method: "PUT",
            table: "clients",
            id: legacy.id,
            row: { ...buildInternalClient("a1", TS), id: legacy.id },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(readRequiredString(readResponseBodyRecord(res), "error")).toMatch(/remain active/i);
    expect((await rowById({ app, entity: "clients", accountId: "a1", id: INTERNAL.id }))?.builtin).toBe(true);
    const retainedLegacy = await rowById({ app, entity: "clients", accountId: "a1", id: legacy.id });
    expect(retainedLegacy?.builtin).toBeUndefined();
    expect(typeof retainedLegacy?.archivedAt).toBe("string");
    expect((await rowById({ app, entity: "clients", accountId: "a1", id: ordinary.id }))?.name).toBe(ordinary.name);
  });

  it("rejects direct descendant writes beneath archived or transitively deleted ancestors", async () => {
    const { app, db } = offAppWith({
      accounts: [account("a1")],
      clients: [
        client("c-active", "a1"),
        client("c-archived", "a1", justArchived),
        client("c-deleted", "a1", archivedTombstone),
      ],
      projects: [
        project({ id: "p-deleted", accountId: "a1", clientId: "c-active", extra: archivedTombstone }),
        project({ id: "p-archived", accountId: "a1", clientId: "c-archived", extra: justArchived }),
        project({ id: "p-under-deleted-client", accountId: "a1", clientId: "c-deleted" }),
      ],
      phases: [phase("ph-under-archived", "a1", "p-archived"), phase("ph-existing", "a1", "p-under-deleted-client")],
      resources: [person("placeholder-under-deleted-project", "a1", { kind: "placeholder", projectId: "p-deleted" })],
    });

    const {
      beneathArchivedProject,
      beneathDeletedClient,
      updateBeneathDeletedClient,
      updateBeneathArchivedProject,
      updatePlaceholderBeneathDeletedProject,
    } = await submitDescendantWrites(app);

    expect(beneathArchivedProject.statusCode).toBe(400);
    expect(beneathDeletedClient.statusCode).toBe(400);
    expect(updateBeneathDeletedClient.statusCode).toBe(400);
    expect(updateBeneathArchivedProject.statusCode).toBe(400);
    expect(updatePlaceholderBeneathDeletedProject.statusCode).toBe(400);
    expect(readRequiredString(readResponseBodyRecord(updatePlaceholderBeneathDeletedProject), "error")).toBe(
      "Records beneath an archived or soft-deleted ancestor cannot be changed through generic endpoints.",
    );
    expect(db.prepare(`SELECT id FROM phases WHERE id = 'ph-new'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT id FROM activities WHERE id = 'act-new'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT name FROM phases WHERE id = 'ph-existing'`).get()).toEqual({ name: "Phase 1" });
    expect(db.prepare(`SELECT name FROM phases WHERE id = 'ph-under-archived'`).get()).toEqual({ name: "Phase 1" });
    expect(db.prepare(`SELECT role FROM resources WHERE id = 'placeholder-under-deleted-project'`).get()).toEqual({
      role: "Designer",
    });
  });

  it("atomically rejects batch updates beneath an archived ancestor", async () => {
    const { app, db } = offAppWith({
      accounts: [account("a1")],
      clients: [client("c1", "a1")],
      projects: [project({ id: "p1", accountId: "a1", clientId: "c1" })],
      phases: [phase("ph1", "a1", "p1")],
    });
    expect(
      (await lifecycleAction({ app, entity: "clients", id: "c1", action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);

    const batch = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: {
        ops: [
          {
            method: "PUT",
            table: "phases",
            id: "ph1",
            row: {
              ...phase("ph1", "a1", "p1"),
              name: "Invisible batch update",
            },
          },
          {
            method: "PUT",
            table: "activities",
            id: "act-batch",
            row: activity({ id: "act-batch", accountId: "a1", projectId: "p1", phaseId: "ph1" }),
          },
        ],
      },
    });

    expect(batch.statusCode).toBe(400);
    expect(db.prepare(`SELECT name FROM phases WHERE id = 'ph1'`).get()).toEqual({ name: "Phase 1" });
    expect(db.prepare(`SELECT id FROM activities WHERE id = 'act-batch'`).get()).toBeUndefined();
  });

  it("PUT and batch-PUT with a body that OMITS the tombstone do not clear an existing one", async () => {
    const { app } = offAppWith({
      accounts: [account("a1")],
      resources: [person("rPut", "a1"), person("rBatch", "a1")],
    });
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rPut", action: "archive", accountId: "a1" })).statusCode,
    ).toBe(200);
    expect(
      (await lifecycleAction({ app, entity: "resources", id: "rBatch", action: "archive", accountId: "a1" }))
        .statusCode,
    ).toBe(200);

    // PUT the FULL row (person() omits archivedAt): pre-fix this NULLed the column; now it's pinned.
    const archivedPut = await rowById({ app, entity: "resources", accountId: "a1", id: "rPut" });
    const put = await call(app, {
      method: "PUT",
      url: "/api/resources/rPut",
      payload: person("rPut", "a1", {
        role: "Lead",
        updatedAt: archivedPut?.updatedAt,
      }),
    });
    expect(put.statusCode).toBe(200);
    expect(typeof (await rowById({ app, entity: "resources", accountId: "a1", id: "rPut" }))?.archivedAt).toBe(
      "string",
    );

    // Same via the batch sync path (the real client verb) — the changed call site is covered too.
    const archivedBatch = await rowById({ app, entity: "resources", accountId: "a1", id: "rBatch" });
    const batch = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: {
        ops: [
          {
            method: "PUT",
            table: "resources",
            id: "rBatch",
            row: person("rBatch", "a1", {
              role: "Lead",
              updatedAt: archivedBatch?.updatedAt,
            }),
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(200);
    expect(typeof (await rowById({ app, entity: "resources", accountId: "a1", id: "rBatch" }))?.archivedAt).toBe(
      "string",
    );
  });
});
