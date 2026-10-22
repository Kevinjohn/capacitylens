import type { ISOTimestamp, Resource } from "../../types/entities.js";
import { parseISOTimestamp } from "../../lib/integrity.js";
import { shortIdTag } from "../privateNames.js";
import { lifecycleStatus, isValidTombstone } from "./types.js";
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
  return Object.assign({ ...entity }, { archivedAt: new Date(archivedMs).toISOString(), deletedAt: null });
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
  const next = Object.assign({ ...entity }, { archivedAt: null });
  // A malformed deletedAt is ignored by lifecycleStatus so the nearest valid state is archived;
  // remove that stale corruption while completing the recovery transition to active.
  if (!isValidTombstone(next.deletedAt)) Object.assign(next, { deletedAt: null });
  return next;
}

/**
 * Scrub a Resource's name and role for anonymisation, preserving all other fields.
 * Returns a new Resource with a deterministic token from {@link shortIdTag}, for every resource kind.
 * This standalone transform sets no tombstones; callers scrub dependent notes and avatars.
 * Extend this scrub if Resource gains personal fields such as email or ssoUserId. Authentication-member
 * erasure remains a separate server concern because those fields do not exist on a Resource.
 */
export function obfuscateResource(resource: Resource): Resource {
  return { ...resource, name: `Removed person #${shortIdTag(resource.id)}`, role: "Removed resource" };
}
