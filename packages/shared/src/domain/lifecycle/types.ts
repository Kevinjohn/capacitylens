import type { ISOTimestamp } from "../../types/entities.js";
import { parseISOTimestamp } from "../../lib/integrity.js";

/** Derive three lifecycle states from valid tombstones; no state column is persisted.
 * Active means neither timestamp is valid. Archived means archivedAt is valid and deletedAt is not.
 * Deleted means deletedAt is valid, which takes precedence over archivedAt.
 * These states define the lifecycle predicates and transitions. */
export type LifecycleState = "active" | "archived" | "deleted";

/**
 * The minimal structural shape the lifecycle machine reads and writes, the two optional tombstone
 * timestamps. Resource, Client, Project and Activity all satisfy this by carrying the same two fields,
 * so the machine is generic over the shape rather than coupled to those concrete types: a transition
 * takes `<T extends LifecycleFields>` and returns `T`, so `archive(aResource)` yields a `Resource`
 * with its other fields untouched.
 *
 * Named `LifecycleFields` (over `Lifecyclable`) to read as "the fields the lifecycle owns". It's a
 * structural constraint on the entity, not a capability the entity has.
 */
export interface LifecycleFields {
  /** ISO 8601 timestamp of when the entity was archived (soft, reversible). Absent/null = not archived. */
  archivedAt?: ISOTimestamp | null;
  /** ISO 8601 timestamp of the soft-delete tombstone. Absent/null = not deleted. `deletedAt` wins. */
  deletedAt?: ISOTimestamp | null;
}

/** Tables with lifecycle tombstones, shared by lifecycle routing and write validation. */
export const LIFECYCLE_ENTITY_KEYS = Object.freeze(["resources", "clients", "projects", "activities"] as const);
/** A tombstone-carrying table; see {@link LIFECYCLE_ENTITY_KEYS}. */
export type LifecycleEntityKey = (typeof LIFECYCLE_ENTITY_KEYS)[number];
/** Narrowing guard: is `entityKey` one of the tombstone-carrying tables? */
export const isLifecycleEntityKey = (entityKey: string): entityKey is LifecycleEntityKey =>
  (LIFECYCLE_ENTITY_KEYS as readonly string[]).includes(entityKey);

/** Lifecycle state is derived only from a canonical, parseable tombstone. Import repair uses the
 * same nearest-valid-state rule; applying it at this read boundary prevents legacy/direct database
 * corruption from creating a hidden state with no legal transition. Purge remains independently
 * fail-closed below and never acts on an invalid deletion timestamp. */
export function isValidTombstone(value: ISOTimestamp | null | undefined): value is ISOTimestamp {
  return value != null && parseISOTimestamp(value) !== null;
}

/** Derive lifecycle state from valid tombstones without reading the clock. Pure.
 * A valid deletedAt wins; otherwise a valid archivedAt means archived, and neither means active.
 * Malformed tombstones are ignored so a later valid transition can repair the row. */
export function lifecycleStatus(entity: LifecycleFields): LifecycleState {
  if (isValidTombstone(entity.deletedAt)) return "deleted";
  if (isValidTombstone(entity.archivedAt)) return "archived";
  return "active";
}
