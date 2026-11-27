import type { ISOTimestamp } from '../../types/entities.js'
import { parseISOTimestamp } from '../../lib/isoDates.js'

/** Derive two lifecycle states from a valid archive tombstone; no state column is persisted.
 * Archived means archivedAt is valid; otherwise the entity is active.
 * These states define the lifecycle predicates and transitions. */
export type LifecycleState = 'active' | 'archived'

/**
 * The minimal structural shape the lifecycle machine reads and writes, the optional archive
 * tombstone. Resource, Client, Project and Activity all satisfy this by carrying the same field,
 * so the machine is generic over the shape rather than coupled to those concrete types: a transition
 * takes `<T extends LifecycleFields>` and returns `T`, so `archive(aResource)` yields a `Resource`
 * with its other fields untouched.
 *
 * Named `LifecycleFields` (over `Lifecyclable`) to read as "the fields the lifecycle owns". It's a
 * structural constraint on the entity, not a capability the entity has.
 */
export interface LifecycleFields {
  /** ISO 8601 timestamp of when the entity was archived (soft, reversible). Absent/null = not archived. */
  archivedAt?: ISOTimestamp | null
}

/** Tables with lifecycle tombstones, shared by lifecycle routing and write validation. */
export const LIFECYCLE_ENTITY_KEYS = Object.freeze([
  'resources',
  'clients',
  'projects',
  'activities',
] as const)
/** A tombstone-carrying table; see {@link LIFECYCLE_ENTITY_KEYS}. */
export type LifecycleEntityKey = (typeof LIFECYCLE_ENTITY_KEYS)[number]
/** Narrowing guard: is `entityKey` one of the tombstone-carrying tables? */
export const isLifecycleEntityKey = (entityKey: string): entityKey is LifecycleEntityKey =>
  (LIFECYCLE_ENTITY_KEYS as readonly string[]).includes(entityKey)

/** Lifecycle state is derived only from a canonical, parseable tombstone. Applying this rule at
 * the read boundary prevents direct database corruption from creating a hidden state with
 * no legal transition. Imports validate tombstones rather than repairing them. */
export function isValidTombstone(value: ISOTimestamp | null | undefined): value is ISOTimestamp {
  return value != null && parseISOTimestamp(value) !== null
}

/** Derive lifecycle state from a valid tombstone without reading the clock. Pure.
 * A valid archivedAt means archived; otherwise the entity is active.
 * A malformed tombstone is ignored so a later valid transition can repair the row. */
export function resolveLifecycleStatus(entity: LifecycleFields): LifecycleState {
  if (isValidTombstone(entity.archivedAt)) return 'archived'
  return 'active'
}
