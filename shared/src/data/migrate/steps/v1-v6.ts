import { availableInternalClientId, buildInternalClient } from "../../internalClient";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

// v1 → v2: early resources carried a boolean `isFreelancer`; convert it to the
// richer `employmentType` enum.
export function migrateV1toV2(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.resources)) return data;
  const resources = data.resources.map((resource) => {
    if (!isRecord(resource)) return resource;
    if ("isFreelancer" in resource && resource.employmentType === undefined) {
      const migratedResource: Record<string, unknown> = {
        ...resource,
        employmentType: resource.isFreelancer ? "freelancer" : "permanent",
      };
      delete migratedResource.isFreelancer;
      return migratedResource;
    }
    return resource;
  });
  return { ...data, resources };
}

// v3 → v4: activities gained a required `kind` discriminant (project | internal | repeatable).
// Backfill it from the only signal a pre-v4 row carried: a project-bound one is 'project';
// a project-less ("general") one becomes 'repeatable' — the rename of "general". 'internal'
// is a genuinely new bucket, set explicitly via the UI afterwards, never inferred here.
// Versionless/partially migrated blobs may already use `activities`, or even carry both keys, so
// backfill every present table before the v4→v5 merge.
export function migrateV3toV4(data: Record<string, unknown>): Record<string, unknown> {
  const applyKindBackfill = (rows: unknown[]): unknown[] =>
    rows.map((activity) => {
      if (!isRecord(activity)) return activity;
      if (activity.kind !== undefined) return activity; // already v4 (or hand-set) — leave it
      return {
        ...activity,
        kind: activity.projectId !== undefined && activity.projectId !== null ? "project" : "repeatable",
      };
    });
  const tasks = Array.isArray(data.tasks) ? applyKindBackfill(data.tasks) : undefined;
  const activities = Array.isArray(data.activities) ? applyKindBackfill(data.activities) : undefined;
  if (!tasks && !activities) return data;
  return {
    ...data,
    ...(tasks ? { tasks } : {}),
    ...(activities ? { activities } : {}),
  };
}

// v4 → v5: the domain concept "Task" was renamed "Activity". Rename the `tasks` table to
// `activities`, and every allocation's `taskId` foreign key to `activityId`. Pure key
// renames — no field values change (the `kind` strings 'project'|'internal'|'repeatable'
// are unaffected). Idempotent: a blob already on the new shape (no `tasks` key) passes
// through untouched. An in-progress blob carrying BOTH keys keeps every distinct row while
// preferring the modern activity when the same valid id appears in both tables.
export function migrateV4toV5(data: Record<string, unknown>): Record<string, unknown> {
  const migratedData: Record<string, unknown> = { ...data };
  // Rename/merge the table: `tasks` → `activities`. Modern rows come first and own id
  // conflicts; malformed/missing ids are retained for the import sanitiser to repair later.
  if (Array.isArray(migratedData.tasks)) {
    if (!Array.isArray(migratedData.activities)) {
      migratedData.activities = migratedData.tasks;
    } else {
      const modernIds = new Set(
        migratedData.activities.flatMap((activity) => {
          if (!isRecord(activity)) return [];
          const id = activity.id;
          return typeof id === "string" && id.length > 0 ? [id] : [];
        }),
      );
      const legacyOnly = migratedData.tasks.filter((task) => {
        if (!isRecord(task)) return true;
        const id = task.id;
        return typeof id !== "string" || id.length === 0 || !modernIds.has(id);
      });
      migratedData.activities = [...migratedData.activities, ...legacyOnly];
    }
  }
  delete migratedData.tasks;
  // Rename the FK on every allocation: `taskId` → `activityId`.
  if (Array.isArray(migratedData.allocations)) {
    migratedData.allocations = migratedData.allocations.map((allocation) => {
      if (!isRecord(allocation) || !("taskId" in allocation)) return allocation;
      const migratedAllocation: Record<string, unknown> = { ...allocation };
      if (!("activityId" in migratedAllocation)) migratedAllocation.activityId = migratedAllocation.taskId;
      delete migratedAllocation.taskId;
      return migratedAllocation;
    });
  }
  return migratedData;
}

// v5 → v6: ensure EVERY account carries exactly one built-in "Internal" client (`builtin: true`).
// A real, persisted Client (not a sentinel) so it can own projects and bucket project-less
// activities. IDEMPOTENT: an account that already has a `builtin` client is left alone, so this is
// safe to run repeatedly and on already-migrated / seeded data — a duplicate is never created, and a
// blob that already satisfies the invariant round-trips deep-equal (no client added → no change).
// Detection is by the FLAG, not an id (so it survives import-remap). Runs AFTER the v4→v5 rename, so
// the tables are at their current names; `accounts`/`clients` may be absent on a partial blob — we
// no-op then (an account-less import slice has nothing to attach an Internal client to).
//
// This is the typed `ensureInternalClients` algorithm (see internalClient.ts) re-expressed for the
// RAW, untyped migration blob: a versioned migration runs on a pre-typed `Record<string, unknown>`
// and must stay deterministic (no live clock — a fixed timestamp), so it can't call the typed helper
// directly. The row SHAPE + the "match builtin by flag + accountId" predicate are kept in lockstep by
// using the shared `buildInternalClient` factory for the row literal.
export function migrateV5toV6(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.accounts) || data.accounts.length === 0) return data;
  const clients = Array.isArray(data.clients) ? [...data.clients] : [];
  const accountsWithBuiltin = new Set(
    clients.flatMap((client) => {
      if (!isRecord(client)) return [];
      return client.builtin === true && typeof client.accountId === "string" ? [client.accountId] : [];
    }),
  );
  // Migrated rows are newly created here; a fixed timestamp keeps the migration deterministic.
  const createdAt = "2026-01-01T00:00:00.000Z";
  const usedClientIds = new Set(
    clients.flatMap((client) => (isRecord(client) && typeof client.id === "string" ? [client.id] : [])),
  );
  let hasAddedClient = false;
  for (const account of data.accounts) {
    if (!isRecord(account)) continue;
    const accountId = account.id;
    if (typeof accountId !== "string" || accountsWithBuiltin.has(accountId)) continue;
    const id = availableInternalClientId(accountId, usedClientIds);
    clients.push(buildInternalClient(accountId, createdAt, id));
    usedClientIds.add(id);
    accountsWithBuiltin.add(accountId);
    hasAddedClient = true;
  }
  return hasAddedClient ? { ...data, clients } : data;
}
