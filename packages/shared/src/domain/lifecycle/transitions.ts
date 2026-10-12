import type { ISOTimestamp, Resource } from "../../types/entities.js";
import { parseISOTimestamp } from "../../lib/integrity.js";
import { shortIdTag } from "../privateNames.js";
import { lifecycleStatus, isValidTombstone, PURGE_MIN_AGE_MS } from "./types.js";
import type { LifecycleFields } from "./types.js";

/**
 * May this entity be archived? Pure affordance predicate, true iff the entity is currently
 * `'active'`. Lets a caller gate an "Archive" control without a try/catch; it is the single-source
 * guard the {@link archive} transition itself re-uses, so the affordance and the transition can't
 * disagree (mirrors access.ts's `can*` predicates).
 *
 * @param entity - the entity to test.
 * @returns `true` iff {@link lifecycleStatus} is `'active'`.
 */
export function canArchive(entity: LifecycleFields): boolean {
  return lifecycleStatus(entity) === "active";
}

/**
 * May this entity be un-archived (restored to active)? Pure affordance predicate, true iff the
 * entity is currently `'archived'`. A `'deleted'` tombstone is not un-archivable (it must be
 * restored via a different path, not by clearing `archivedAt`), and an `'active'` entity has nothing
 * to undo.
 *
 * @param entity - the entity to test.
 * @returns `true` iff {@link lifecycleStatus} is `'archived'`.
 */
export function canUnarchive(entity: LifecycleFields): boolean {
  return lifecycleStatus(entity) === "archived";
}

/** Check whether an entity may be soft-deleted.
 * Pure; only archived entities qualify because deletion requires prior archival.
 * This is a separate policy question from canUnarchive even though both currently require the archived state. */
export function canSoftDelete(entity: LifecycleFields): boolean {
  return lifecycleStatus(entity) === "archived";
}

/**
 * May this soft-deleted tombstone be hard-purged now? Pure, fail-closed eligibility predicate.
 * Requires a valid deletion timestamp at least PURGE_MIN_AGE_DAYS old (inclusive), measured against
 * the caller-supplied nowISO. Missing or invalid timestamps refuse purge; no ambient clock is read.
 * The actual row deletion remains server-side.
 */
export function canPurge(entity: LifecycleFields, nowISO: ISOTimestamp): boolean {
  // Fail-closed: only a soft-deleted tombstone is ever purgeable.
  if (lifecycleStatus(entity) !== "deleted") return false;
  // `lifecycleStatus === 'deleted'` guarantees `deletedAt` is present; parse both ends.
  const deletedMs = parseISOTimestamp(entity.deletedAt);
  const nowMs = parseISOTimestamp(nowISO);
  // Fail-closed at an untyped boundary: only the supported strict ISO shape may unlock a purge.
  if (deletedMs === null || nowMs === null) return false;
  return nowMs - deletedMs >= PURGE_MIN_AGE_MS;
}

/** Why a lifecycle transition was refused. */
export type LifecycleTransitionErrorCode = "already_inactive" | "invalid_transition";

/** A lifecycle precondition failure that API adapters may classify without inspecting prose. */
export class LifecycleTransitionError extends Error {
  readonly code: LifecycleTransitionErrorCode;

  constructor(code: LifecycleTransitionErrorCode, message: string) {
    super(message);
    this.name = "LifecycleTransitionError";
    this.code = code;
  }
}

/**
 * Archive an entity (active → archived). Returns a new object with `archivedAt` set to `nowISO`; the
 * input is not mutated and every other field flows through unchanged (the generic `<T>` preserves the
 * concrete type, so `archive(aResource)` returns a `Resource`).
 *
 * Throws if the entity is not `'active'` (re-archiving an archived/deleted record is a caller
 * bug). The guard is the shared {@link canArchive}
 * predicate, so the throw condition can't drift from the affordance.
 *
 * @param entity - the entity to archive (must be `'active'`).
 * @param nowISO - the caller-supplied archive timestamp (the store/server owns the clock).
 * @returns a new entity of the same type with a canonical `archivedAt`.
 * @throws {Error} if the entity is already archived/deleted or the timestamp is invalid.
 */
export function archive<T extends LifecycleFields>(entity: T, nowISO: ISOTimestamp): T {
  if (!canArchive(entity)) {
    const status = lifecycleStatus(entity);
    throw new LifecycleTransitionError(
      status === "archived" ? "already_inactive" : "invalid_transition",
      `Cannot archive: entity is already ${status}.`,
    );
  }
  const archivedMs = parseISOTimestamp(nowISO);
  if (archivedMs === null) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      "Cannot archive: archive time must be a valid ISO timestamp.",
    );
  }
  const next = { ...entity };
  delete next.archivedAt;
  delete next.deletedAt;
  return { ...next, archivedAt: new Date(archivedMs).toISOString() };
}

/** Restore an archived entity to active without mutating it.
 * Removes archivedAt and any malformed deletedAt; a valid deleted tombstone is rejected.
 * @throws LifecycleTransitionError when the entity is not archived. */
export function unarchive<T extends LifecycleFields>(entity: T): T {
  if (!canUnarchive(entity)) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      `Cannot unarchive: entity is ${lifecycleStatus(entity)}, not archived.`,
    );
  }
  // Remove archivedAt to represent the active state by absence.
  const next = { ...entity };
  delete next.archivedAt;
  // A malformed deletedAt is ignored by lifecycleStatus so the nearest valid state is archived;
  // remove that stale corruption while completing the recovery transition to active.
  if (!isValidTombstone(next.deletedAt)) delete next.deletedAt;
  return next;
}

/**
 * Soft-delete an entity (archived → deleted). Returns a new object with `deletedAt` set to a valid
 * canonical instant no earlier than `archivedAt`, preserving `archivedAt`. The tombstone retains
 * when it was archived; {@link lifecycleStatus} still reads `'deleted'` because `deletedAt` wins.
 * The input is not mutated. A caller clock behind the archive is clamped to the archive instant so
 * this transition cannot create ordering that import must later repair by dropping the deletion.
 *
 * Throws if the entity is not `'archived'`, enforcing the Decisions rule that soft-delete
 * requires prior archival (you cannot delete an active record directly), and refusing to re-delete an
 * existing tombstone. The guard is the shared {@link canSoftDelete} predicate.
 *
 * @param entity - the entity to soft-delete (must be `'archived'`).
 * @param nowISO - the caller-supplied delete timestamp (the store/server owns the clock).
 * @returns a new entity of the same type with an ordered `deletedAt` and `archivedAt` preserved.
 * @throws {Error} if the entity is not currently archived or either timestamp is invalid.
 */
export function softDelete<T extends LifecycleFields>(entity: T, nowISO: ISOTimestamp): T {
  if (!canSoftDelete(entity)) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      `Cannot delete: entity must be archived first (is ${lifecycleStatus(entity)}).`,
    );
  }
  const archivedMs = parseISOTimestamp(entity.archivedAt);
  const deletedMs = parseISOTimestamp(nowISO);
  if (archivedMs === null || deletedMs === null) {
    throw new LifecycleTransitionError(
      "invalid_transition",
      "Cannot delete: archive and deletion times must be valid ISO timestamps.",
    );
  }
  return { ...entity, deletedAt: new Date(Math.max(archivedMs, deletedMs)).toISOString() };
}

/**
 * Scrub a Resource's name and role for the soft-delete grace window, preserving all other fields.
 * Returns a new Resource with a deterministic token from {@link shortIdTag}, for every resource kind.
 * This standalone transform sets no tombstones; callers compose it with {@link softDelete}.
 * Extend this scrub if Resource gains personal fields such as email or ssoUserId. Authentication-member
 * erasure remains a separate server concern because those fields do not exist on a Resource.
 */
export function obfuscateResource(resource: Resource): Resource {
  return { ...resource, name: `Removed person #${shortIdTag(resource.id)}`, role: "Removed resource" };
}

// Note: there is deliberately no `purge(entity)` function. Purge is a hard row-delete done
// server-side; the entity simply ceases to exist, so there is no "next entity" to return.
// This module provides only the {@link canPurge} eligibility predicate plus the derive helpers.
