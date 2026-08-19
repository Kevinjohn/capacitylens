import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "./app";
import { getRow, openDb, upsertRow, type Db } from "./db";
import { call } from "./testHelpers";

const ACCOUNT_ID = "a1";
const ACTIVITY_ID = "activity";
const ALLOCATION_ID = "allocation";
const PROJECT_ID = "p1";
const BASE_REVISION = "2098-01-01T00:00:00.000Z";
const SERVER_NOW = Date.parse("2099-01-01T00:00:00.000Z");

type ActivityKind = "project" | "internal" | "repeatable";
type ModelOperation =
  | { label: string; type: "kind"; kind: ActivityKind }
  | { label: string; type: "allocation-upsert"; attributed: boolean }
  | { label: string; type: "allocation-delete" };

interface ModelAllocation extends Record<string, unknown> {
  id: string;
  accountId: string;
  resourceId: string;
  activityId: string;
  projectId?: string;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ModelState {
  activity: ReturnType<typeof activityRow>;
  allocation?: ModelAllocation;
  rewrite?: { table: "allocations"; id: string; createdAt: string; updatedAt: string; rewrite: true };
}

const META = { createdAt: BASE_REVISION, updatedAt: BASE_REVISION };

const activityRow = (kind: ActivityKind) => ({
  id: ACTIVITY_ID,
  accountId: ACCOUNT_ID,
  name: "Company-wide work",
  kind,
  ...(kind === "project" ? { projectId: PROJECT_ID } : {}),
  ...META,
});

const allocationRow = (attributed: boolean): ModelAllocation => ({
  id: ALLOCATION_ID,
  accountId: ACCOUNT_ID,
  resourceId: "r1",
  activityId: ACTIVITY_ID,
  ...(attributed ? { projectId: PROJECT_ID } : {}),
  startDate: "2098-01-05",
  endDate: "2098-01-09",
  hoursPerDay: 8,
  status: "confirmed",
  ...META,
});

const INITIAL_ACTIVITY = activityRow("repeatable");
const INITIAL_ALLOCATION = allocationRow(true);

const ALPHABET: readonly ModelOperation[] = [
  { label: "kind→project", type: "kind", kind: "project" },
  { label: "kind→internal", type: "kind", kind: "internal" },
  { label: "kind→repeatable", type: "kind", kind: "repeatable" },
  { label: "allocation{projectId}", type: "allocation-upsert", attributed: true },
  { label: "allocation{}", type: "allocation-upsert", attributed: false },
  { label: "allocation delete", type: "allocation-delete" },
];

const nextRevision = (previous?: string): string =>
  new Date(Math.max(SERVER_NOW, previous === undefined ? 0 : Date.parse(previous) + 1)).toISOString();

/**
 * The deliberately naive specification: apply each operation to one plain object, in order, and
 * restore attribution immediately after that operation. It shares no code with the projection or
 * database implementation. A request-level validation failure rolls the atomic batch back.
 */
function interpret(sequence: readonly ModelOperation[]): { accepted: boolean; state: ModelState } {
  const initial: ModelState = {
    activity: { ...INITIAL_ACTIVITY },
    allocation: { ...INITIAL_ALLOCATION },
  };
  const state = structuredClone(initial);

  for (const operation of sequence) {
    if (operation.type === "kind") {
      state.activity = {
        ...activityRow(operation.kind),
        createdAt: state.activity.createdAt,
        updatedAt: nextRevision(state.activity.updatedAt),
      };
      if (operation.kind !== "repeatable" && state.allocation?.projectId !== undefined) {
        delete state.allocation.projectId;
        state.allocation.updatedAt = nextRevision(state.allocation.updatedAt);
        state.rewrite = {
          table: "allocations",
          id: state.allocation.id,
          createdAt: state.allocation.createdAt,
          updatedAt: state.allocation.updatedAt,
          rewrite: true,
        };
      }
      continue;
    }

    if (operation.type === "allocation-delete") {
      delete state.allocation;
      delete state.rewrite;
      continue;
    }

    if (operation.attributed && state.activity.kind !== "repeatable") {
      return { accepted: false, state: initial };
    }
    const submitted = allocationRow(operation.attributed);
    state.allocation = {
      ...submitted,
      createdAt: state.allocation?.createdAt ?? nextRevision(),
      updatedAt: nextRevision(state.allocation?.updatedAt),
    };
    delete state.rewrite;
  }

  return { accepted: true, state };
}

function enumerateSequences(): ModelOperation[][] {
  const candidates: ModelOperation[][] = [];
  const append = (prefix: ModelOperation[]) => {
    if (prefix.length > 0) candidates.push(prefix);
    if (prefix.length === 4) return;
    for (const operation of ALPHABET) append([...prefix, operation]);
  };
  // Bound: generate every sequence of length 1–4 over six operations (1,554 candidates), then keep
  // those the reference interpreter accepts. Four is the smallest bound that covers flip,
  // flip-back, explicit rewrite/delete, and a following observation. Invalid attribution writes
  // are outside the successful sequential-equivalence rule and are already covered by route tests.
  append([]);
  return candidates.filter((sequence) => interpret(sequence).accepted);
}

const batch = (app: FastifyInstance, ops: unknown[]) =>
  call(app, { method: "POST", url: "/api/batch", payload: { ops } as InjectOptions["payload"] });

const requestOperation = (operation: ModelOperation) => {
  if (operation.type === "kind") {
    return { method: "PUT", table: "activities", id: ACTIVITY_ID, row: activityRow(operation.kind) };
  }
  if (operation.type === "allocation-upsert") {
    return {
      method: "PUT",
      table: "allocations",
      id: ALLOCATION_ID,
      row: allocationRow(operation.attributed),
    };
  }
  return { method: "DELETE", table: "allocations", id: ALLOCATION_ID, accountId: ACCOUNT_ID };
};

describe("POST /api/batch allocation attribution model", () => {
  let app: FastifyInstance;
  let db: Db;

  beforeAll(() => {
    vi.spyOn(Date, "now").mockReturnValue(SERVER_NOW);
    db = openDb(":memory:");
    upsertRow(db, "accounts", { id: ACCOUNT_ID, name: "Wayne Enterprises", color: "#5c34d4", ...META });
    upsertRow(db, "clients", {
      id: "c1",
      accountId: ACCOUNT_ID,
      name: "Wayne Enterprises",
      color: "#5c34d4",
      ...META,
    });
    upsertRow(db, "projects", {
      id: PROJECT_ID,
      accountId: ACCOUNT_ID,
      clientId: "c1",
      name: "Applied Sciences",
      color: "#5c34d4",
      ...META,
    });
    upsertRow(db, "resources", {
      id: "r1",
      accountId: ACCOUNT_ID,
      kind: "person",
      role: "Engineer",
      employmentType: "permanent",
      engagement: "studio",
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
      color: "#5c34d4",
      ...META,
    });
    app = buildApp(db, { optimisticConcurrency: false });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    if (db.isOpen) db.close();
  });

  it("matches sequential interpretation for every bounded operation sequence", async () => {
    const failures: string[] = [];

    for (const sequence of enumerateSequences()) {
      upsertRow(db, "activities", INITIAL_ACTIVITY);
      upsertRow(db, "allocations", INITIAL_ALLOCATION);
      const expected = interpret(sequence);
      const response = await batch(app, sequence.map(requestOperation));
      const actualActivity = getRow(db, "activities", ACTIVITY_ID);
      const actualAllocation = getRow(db, "allocations", ALLOCATION_ID);
      const receiptRewrites =
        response.statusCode === 200
          ? response.json().revisions.filter((revision: { rewrite?: boolean }) => revision.rewrite === true)
          : [];

      try {
        expect(response.statusCode).toBe(expected.accepted ? 200 : 400);
        expect(actualActivity).toEqual(expected.state.activity);
        expect(actualAllocation).toEqual(expected.state.allocation);
        expect(receiptRewrites).toEqual(expected.state.rewrite ? [expected.state.rewrite] : []);
      } catch (error) {
        failures.push(
          `${sequence.map((operation) => operation.label).join(" → ")}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  }, 30_000);
});
