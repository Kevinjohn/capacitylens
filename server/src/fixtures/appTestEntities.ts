import type { AppOptions } from "../app";
import { createApp } from "../app";
import { openDb } from "../db";
import type { Db } from "../db";
// API fixtures exercise the real Fastify and SQLite boundaries with deterministic domain rows.

/**
 * Fixed timestamp shared by fixtures that need deterministic creation and update dates.
 */
export const TS = "2026-01-01T00:00:00.000Z";
/**
 * Maximum time allowed for one batch handler test to finish.
 */
export const MAX_BATCH_HANDLER_BUDGET_MS = 4_000;
/**
 * Expected validation message when an activity belongs to another account.
 */
export const CROSS_ACCOUNT_ACTIVITY_ERROR =
  "Allocation must reference an activity under an active project in this company.";
/**
 * Returns the fixed creation and update timestamps used by fixture rows.
 */
export const meta = () => ({ createdAt: TS, updatedAt: TS });
/**
 * Removes server-managed creation and update timestamps before a fixture is sent as input.
 */
export const withoutRevision = <T extends object>(row: T) => {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
};

type FreshAppOptions = { allowReset?: boolean; extra?: Partial<AppOptions> };
/**
 * Creates an in-memory SQLite database and Fastify app with optional test settings.
 */
export function freshApp({ allowReset = true, extra = {} }: FreshAppOptions = {}) {
  const db = openDb(":memory:");
  return {
    app: createApp(db, { allowReset, optimisticConcurrency: false, ...extra }),
    db,
  };
}

/**
 * Matches full-table selects so tests can detect unscoped server reads.
 */
export const FULL_APP_TABLE_SELECT =
  /^\s*SELECT \* FROM (accounts|disciplines|resources|clients|projects|phases|activities|allocations|timeOff)\s*$/;

/**
 * Returns a database proxy that records full application-table selects.
 */
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

/**
 * Creates a minimal account row with deterministic metadata.
 */
export const account = (id: string) => ({
  id,
  name: "Studio",
  color: "#5c34d4",
  ...meta(),
});
/**
 * Creates a client row linked to the supplied account.
 */
export const client = (id: string, accountId: string) => ({
  id,
  accountId,
  name: "Ferris",
  color: "#5c34d4",
  ...meta(),
});
/**
 * Creates a project row linked to the supplied account and client.
 */
export const project = (id: string, accountId: string, clientId: string) => ({
  id,
  accountId,
  name: "Web",
  clientId,
  color: "#5c34d4",
  ...meta(),
});

/**
 * Supplies the identifiers needed to link an activity fixture to its account and project.
 */
export interface ActivityInput {
  id: string;
  accountId: string;
  projectId: string;
  phaseId?: string | undefined;
}

/**
 * Creates a project activity linked to the supplied account and project.
 */
export const activity = ({ id, accountId, projectId, phaseId }: ActivityInput) => ({
  id,
  accountId,
  name: "Activity",
  kind: "project",
  projectId,
  phaseId,
  ...meta(),
});
/**
 * Creates a weekday person fixture with a stable role, schedule, and discipline color.
 */
export const person = (id: string, accountId: string) => ({
  id,
  accountId,
  kind: "person",
  name: "Bruce Wayne",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#5c34d4",
  ...meta(),
});
/**
 * Creates a placeholder resource, optionally bound to the supplied project.
 */
export const placeholder = (id: string, accountId: string, projectId?: string) => ({
  ...person(id, accountId),
  kind: "placeholder",
  projectId,
});

/**
 * Supplies the resource and activity references plus optional overrides for an allocation row.
 */
export interface AllocationInput {
  id: string;
  accountId: string;
  resourceId: string;
  activityId: string;
  o?: Record<string, unknown> | undefined;
}

/**
 * Creates a confirmed weekday allocation with deterministic dates and optional overrides.
 */
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

/**
 * Supplies the resource and account references for a time-off fixture.
 */
export interface TimeOffInput {
  id: string;
  accountId: string;
  resourceId: string;
  type?: string | undefined;
}

/**
 * Creates one day of time off for the supplied resource.
 */
export const timeOff = ({ id, accountId, resourceId, type = "holiday" }: TimeOffInput) => ({
  id,
  accountId,
  resourceId,
  startDate: "2026-06-03",
  endDate: "2026-06-03",
  type,
  ...meta(),
});
/**
 * Creates an account-wide closure fixture with the supplied name.
 */
export const closure = (id: string, accountId: string, name = "Christmas shutdown") => ({
  id,
  accountId,
  name,
  startDate: "2026-12-24",
  endDate: "2026-12-27",
  ...meta(),
});
