import type { AppOptions } from "../app";
import { createApp } from "../app";
import { openDb, type Db } from "../db";
// API integration tests: drive the real Fastify app + a real (in-memory) node:sqlite
// DB via inject(). Covers CRUD, whole-state read, cascade deletes, import round-trip,
// migration reuse, and the validation rules — which run the SAME shared domain-core
// the client uses, so passing here proves "server validation == client validation".

export const TS = "2026-01-01T00:00:00.000Z";
export const MAX_BATCH_HANDLER_BUDGET_MS = 4_000;
export const CROSS_ACCOUNT_ACTIVITY_ERROR =
  "Allocation must reference an activity under an active project in this company.";
export const meta = () => ({ createdAt: TS, updatedAt: TS });
export const withoutRevision = <T extends object>(row: T) => {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
};

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export function freshApp(allowReset = true, extra: Partial<AppOptions> = {}) {
  const db = openDb(":memory:");
  return {
    app: createApp(db, { allowReset, optimisticConcurrency: false, ...extra }),
    db,
  };
}

export const FULL_APP_TABLE_SELECT =
  /^\s*SELECT \* FROM (accounts|disciplines|resources|clients|projects|phases|activities|allocations|timeOff)\s*$/;

export function dbTrackingFullTableSelects(): {
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
  });
  return { db, raw, fullTableSelects };
}

export const account = (id: string) => ({
  id,
  name: "Studio",
  color: "#5c34d4",
  ...meta(),
});
export const client = (id: string, accountId: string) => ({
  id,
  accountId,
  name: "Acme",
  color: "#5c34d4",
  ...meta(),
});
export const project = (id: string, accountId: string, clientId: string) => ({
  id,
  accountId,
  name: "Web",
  clientId,
  color: "#5c34d4",
  ...meta(),
});

export interface ActivityInput {
  id: string;
  accountId: string;
  projectId: string;
  phaseId?: string | undefined;
}

export const activity = ({ id, accountId, projectId, phaseId }: ActivityInput) => ({
  id,
  accountId,
  name: "Activity",
  kind: "project",
  projectId,
  phaseId,
  ...meta(),
});
export const person = (id: string, accountId: string) => ({
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
export const placeholder = (id: string, accountId: string, projectId?: string) => ({
  ...person(id, accountId),
  kind: "placeholder",
  projectId,
});

export interface AllocationInput {
  id: string;
  accountId: string;
  resourceId: string;
  activityId: string;
  o?: Record<string, unknown> | undefined;
}

export const allocation = ({ id, accountId, resourceId, activityId, o = {} }: AllocationInput) =>
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

export interface TimeOffInput {
  id: string;
  accountId: string;
  resourceId: string;
  type?: string | undefined;
}

export const timeOff = ({ id, accountId, resourceId, type = "holiday" }: TimeOffInput) => ({
  id,
  accountId,
  resourceId,
  startDate: "2026-06-03",
  endDate: "2026-06-03",
  type,
  ...meta(),
});
export const closure = (id: string, accountId: string, name = "Christmas shutdown") => ({
  id,
  accountId,
  name,
  startDate: "2026-12-24",
  endDate: "2026-12-27",
  ...meta(),
});

// app.inject's overloads resolve to a union that hides statusCode/json; this wrapper
// pins the single Promise-returning shape so call sites stay terse.
