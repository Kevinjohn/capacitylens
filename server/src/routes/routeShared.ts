import type { FastifyReply, FastifyRequest } from "fastify";
import type { Action } from "@capacitylens/shared/domain/access";
import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { isScopedEntityKey } from "@capacitylens/shared/types/entities";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import { allocationAttributionAllowed } from "@capacitylens/shared/lib/integrity";
import { clearAllocationAttributionForActivities, type Db, type RewrittenAllocationRevision, upsertRow } from "../db";
import type { BatchStateProjection } from "../batchProjection";
import { TABLES } from "../tables";

export const isKnownTable = (entity: string): entity is keyof typeof TABLES =>
  Object.prototype.hasOwnProperty.call(TABLES, entity);

/**
 * The tables the GENERIC /api/:entity routes serve: every known table except `accounts`, which has
 * its own dedicated static routes (routes/accountEntityRoutes.ts).
 *
 * Fastify matches those static paths first, so this is unreachable in practice — it is a fail-CLOSED
 * backstop. `accounts` carries no accountId column, so every guard the generic handlers derive from
 * `row.accountId` (the isScopedTable authorize gate, ownsRow, the scoped DELETE owner assertion) is
 * a silent no-op for it; if a dedicated verb is ever removed, an account row must 404 loudly here
 * rather than fall through to those no-op scoped semantics. /api/batch keeps its own account
 * handling (a client sync diff genuinely carries accounts ops) and still uses isKnownTable.
 */
export const isGenericEntity = (entity: string): entity is keyof typeof TABLES =>
  isKnownTable(entity) && entity !== "accounts";

// Scoped membership is shared with the import/write sanitizer. Scoped deletes must assert
// ownership via accountId, so this must not be inferred independently from the SQLite codec.
export const isScopedTable = isScopedEntityKey;

// The ONLY three entities that carry the lifecycle tombstones (archivedAt/deletedAt, P2.1) and so can
// run the archive/unarchive/soft-delete/purge routes (P2.5a). A guard, not a free string compare, so a
// lifecycle handler can `entity is LifecycleEntity`-narrow before indexing AppData[entity] — and any
// other table (phases/activities/allocations/timeOff/disciplines/accounts) is a 404 on these routes.
// Single-sourced in shared (LIFECYCLE_ENTITY_KEYS) so this route allow-list and validate.ts's
// sanitizeWrite tombstone-pin can't drift; aliased to the local names the handlers below already use.
export const isLifecycleEntity = isLifecycleEntityKey;

// Tenant-ownership predicate shared by every mutating route. A row is "owned" by
// `accountId` when there's no existing row yet (a fresh upsert), or its stored accountId
// matches. PUT/PATCH use it to keep accountId IMMUTABLE (409 on a change that would re-home
// a row across the tenant boundary); DELETE uses it to scope a delete to its owner (404 on
// a cross-account target — the server analog of the client's findOwned guard). One
// predicate, so a future write path can't silently skip the check.
export const ownsRow = (existing: { accountId?: unknown } | undefined, accountId: unknown): boolean =>
  !existing || existing.accountId === accountId;

/**
 * The stale-write predicate (optimistic concurrency), shared by the direct PUT route and the batch
 * PUT loop so the two paths can never drift. An existing-row replacement must echo the exact
 * server revision; a caller-authored future value is not evidence of freshness. Partial PATCH may
 * omit the precondition for compatibility, but a supplied malformed or mismatched value conflicts.
 */
export function isStaleWrite(
  existing: Record<string, unknown> | undefined,
  row: Record<string, unknown>,
  requirePrecondition = true,
): existing is Record<string, unknown> {
  // (A type GUARD, not a plain boolean: both call sites feed `existing` to redactWriteEcho inside
  // the 409 branch, which needs the `existing`-is-present narrowing the old inline check gave.)
  if (existing === undefined) return false;
  // A corrupt STORED revision must remain repairable rather than write-bricked. Incoming full-row
  // writes, however, require a valid exact precondition; PATCH retains its documented omission-only
  // compatibility path while rejecting an explicitly malformed value.
  if (typeof existing.updatedAt !== "string" || !Number.isFinite(Date.parse(existing.updatedAt))) return false;
  if (typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) {
    return requirePrecondition || Object.hasOwn(row, "updatedAt");
  }
  return Date.parse(existing.updatedAt) !== Date.parse(row.updatedAt);
}

/** Fully visible writer context (unaffected tables, auth OFF, or an owner). One frozen module-level
 * instance keeps the hot generic write paths allocation-free. */
export const ALL_FIELDS_VISIBLE: SanitizeWriteOptions = Object.freeze({
  canSeeTimeOffNote: true,
  canSeePrivateNames: true,
});

export type AuthorizeRoute = (
  req: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
  action: Action,
  options?: { concealNonMembership?: boolean },
) => { role: "owner" | "admin" | "editor" | "viewer" | null } | false;

export function writeActivityRow(
  db: Db,
  projection: BatchStateProjection | undefined,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): RewrittenAllocationRevision[] {
  upsertRow(db, "activities", row);
  projection?.upsert("activities", row);
  const id = row.id as string;
  if (projection) {
    projection.reconcileAllocationAttributionForActivity(id, allocationAttributionAllowed(row.kind));
    return [];
  }
  // A newly created activity cannot have an allocation referencing it yet, so POST/PUT-create
  // never needs a sweep. Direct writes retain their immediate database reconciliation.
  if (!existing || allocationAttributionAllowed(row.kind)) return [];
  return clearAllocationAttributionForActivities(db, new Set([id]));
}

// Activity writes add rewritten allocation revisions beside the ordinary activity echo so
// direct-route callers can reconcile the same server-owned cascade as batch callers.
export function shapeActivityWriteEcho(
  entity: string,
  echo: Record<string, unknown>,
  rewrittenAllocations: RewrittenAllocationRevision[],
): Record<string, unknown> {
  return entity === "activities" ? { ...echo, rewrittenAllocations } : echo;
}
