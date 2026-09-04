import { availableInternalClientId, buildInternalClient } from "../../internalClient";

// v1 → v2: early resources carried a boolean `isFreelancer`; convert it to the
// richer `employmentType` enum.
export function migrateV1toV2(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.resources)) return data;
  const resources = data.resources.map((r) => {
    if (!r || typeof r !== "object") return r;
    const rec = r as Record<string, unknown>;
    if ("isFreelancer" in rec && rec.employmentType === undefined) {
      const next: Record<string, unknown> = { ...rec, employmentType: rec.isFreelancer ? "freelancer" : "permanent" };
      delete next.isFreelancer;
      return next;
    }
    return rec;
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
  const backfill = (rows: unknown[]): unknown[] =>
    rows.map((t) => {
      if (!t || typeof t !== "object") return t;
      const rec = t as Record<string, unknown>;
      if (rec.kind !== undefined) return rec; // already v4 (or hand-set) — leave it
      return { ...rec, kind: rec.projectId !== undefined && rec.projectId !== null ? "project" : "repeatable" };
    });
  const tasks = Array.isArray(data.tasks) ? backfill(data.tasks) : undefined;
  const activities = Array.isArray(data.activities) ? backfill(data.activities) : undefined;
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
  const next: Record<string, unknown> = { ...data };
  // Rename/merge the table: `tasks` → `activities`. Modern rows come first and own id
  // conflicts; malformed/missing ids are retained for the import sanitiser to repair later.
  if (Array.isArray(next.tasks)) {
    if (!Array.isArray(next.activities)) {
      next.activities = next.tasks;
    } else {
      const modernIds = new Set(
        next.activities.flatMap((activity) => {
          if (!activity || typeof activity !== "object") return [];
          const id = (activity as Record<string, unknown>).id;
          return typeof id === "string" && id.length > 0 ? [id] : [];
        }),
      );
      const legacyOnly = next.tasks.filter((task) => {
        if (!task || typeof task !== "object") return true;
        const id = (task as Record<string, unknown>).id;
        return typeof id !== "string" || id.length === 0 || !modernIds.has(id);
      });
      next.activities = [...next.activities, ...legacyOnly];
    }
  }
  delete next.tasks;
  // Rename the FK on every allocation: `taskId` → `activityId`.
  if (Array.isArray(next.allocations)) {
    next.allocations = next.allocations.map((a) => {
      if (!a || typeof a !== "object") return a;
      const rec = a as Record<string, unknown>;
      if (!("taskId" in rec)) return rec;
      const renamed: Record<string, unknown> = { ...rec };
      if (!("activityId" in renamed)) renamed.activityId = renamed.taskId;
      delete renamed.taskId;
      return renamed;
    });
  }
  return next;
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
      if (!client || typeof client !== "object") return [];
      const rec = client as Record<string, unknown>;
      return rec.builtin === true && typeof rec.accountId === "string" ? [rec.accountId] : [];
    }),
  );
  // Migrated rows are newly created here; a fixed timestamp keeps the migration deterministic.
  const now = "2026-01-01T00:00:00.000Z";
  const usedIds = new Set(
    clients.flatMap((client) =>
      client && typeof client === "object" && typeof (client as Record<string, unknown>).id === "string"
        ? [(client as Record<string, unknown>).id as string]
        : [],
    ),
  );
  let added = false;
  for (const account of data.accounts) {
    if (!account || typeof account !== "object") continue;
    const accountId = (account as Record<string, unknown>).id;
    if (typeof accountId !== "string" || accountsWithBuiltin.has(accountId)) continue;
    const id = availableInternalClientId(accountId, usedIds);
    clients.push(buildInternalClient(accountId, now, id));
    usedIds.add(id);
    accountsWithBuiltin.add(accountId);
    added = true;
  }
  return added ? { ...data, clients } : data;
}
