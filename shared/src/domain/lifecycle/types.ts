import type { ISOTimestamp } from "../../types/entities";
import { parseISOTimestamp } from "../../lib/integrity";

/**
 * The three DERIVED lifecycle states an entity can be read as. There is no stored `state` column —
 * the state is derived from the `archivedAt`/`deletedAt` tombstone fields (see {@link lifecycleStatus}):
 * - `'active'`   — neither tombstone set (the default; absent = active).
 * - `'archived'` — valid `archivedAt` set, valid `deletedAt` absent (soft, reversible: hidden from scheduling
 *                  but fully retained).
 * - `'deleted'`  — valid `deletedAt` set (a soft-delete tombstone). `deletedAt` WINS over `archivedAt`: a
 *                  record archived-then-deleted reads `'deleted'`, never `'archived'`.
 *
 * INVARIANT: these are the only three states; the predicates + transitions below are exhaustive over
 * them. Adding a state means adding it here first so every guard accounts for it.
 */
export type LifecycleState = "active" | "archived" | "deleted";

/**
 * The minimal structural shape the lifecycle machine reads and writes — the two optional tombstone
 * timestamps. Resource, Client and Project (P2.1) all satisfy this by carrying the same two fields,
 * so the machine is generic over the shape rather than coupled to those concrete types: a transition
 * takes `<T extends LifecycleFields>` and returns `T`, so `archive(aResource)` yields a `Resource`
 * with its other fields untouched.
 *
 * Named `LifecycleFields` (over `Lifecyclable`) to read as "the fields the lifecycle owns" — it's a
 * structural CONSTRAINT on the entity, not a capability the entity has.
 */
export interface LifecycleFields {
  /** ISO 8601 timestamp of when the entity was archived (soft, reversible). Absent/null = not archived. */
  archivedAt?: ISOTimestamp;
  /** ISO 8601 timestamp of the soft-delete tombstone. Absent/null = not deleted. `deletedAt` wins. */
  deletedAt?: ISOTimestamp;
}

/**
 * The entity tables that carry the lifecycle tombstones (archivedAt/deletedAt) and so run the
 * archive/unarchive/soft-delete/purge routes. Single-sourced HERE (the pure module both app and
 * server import) so the server's lifecycle-route allow-list (`isLifecycleEntity` in app.ts) and the
 * `sanitizeWrite` tombstone-pin (validate.ts) can't drift apart — two hand-rolled copies of this set
 * is exactly what silently rots if a 4th entity ever grows tombstones. Every other table
 * (phases/activities/allocations/timeOff/disciplines/accounts) is deliberately OUT.
 */
export const LIFECYCLE_ENTITY_KEYS = Object.freeze(["resources", "clients", "projects"] as const);
export type LifecycleEntityKey = (typeof LIFECYCLE_ENTITY_KEYS)[number];
/** Narrowing guard: is `e` one of the tombstone-carrying tables? */
export const isLifecycleEntityKey = (e: string): e is LifecycleEntityKey =>
  (LIFECYCLE_ENTITY_KEYS as readonly string[]).includes(e);

/**
 * The minimum age (in days) a soft-deleted tombstone must reach before it may be HARD-purged
 * (Admin-only, server-side, P2.5). Per the CapacityLens Decisions data-lifecycle rule: a tombstone
 * is retained for a grace window before the row is physically removed, so an accidental delete is
 * recoverable for at least this long. Consumed by {@link canPurge}.
 */
export const PURGE_MIN_AGE_DAYS = 30;

// The purge grace window expressed in milliseconds (derived from PURGE_MIN_AGE_DAYS, NO magic
// numbers) — the unit `Date.parse` works in, so {@link canPurge} can compare tombstone age directly.
export const PURGE_MIN_AGE_MS = PURGE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

// Lifecycle state is derived only from a canonical, parseable tombstone. Import repair uses the
// same nearest-valid-state rule; applying it at this read boundary prevents legacy/direct database
// corruption from creating a hidden state with no legal transition. Purge remains independently
// fail-closed below and never acts on an invalid deletion timestamp.
export function isValidTombstone(value: ISOTimestamp | null | undefined): value is ISOTimestamp {
  return value != null && parseISOTimestamp(value) !== null;
}

/**
 * Derive the {@link LifecycleState} of an entity from its tombstone fields. PURE: a function of the
 * two fields only — no I/O, no Date.
 *
 * Precedence is load-bearing: `deletedAt` WINS over `archivedAt`, so a record that was
 * archived-then-deleted reads `'deleted'` (a tombstone, not "archived"). `archivedAt` is only
 * consulted when `deletedAt` is absent. Both `undefined` and `null` count as absent.
 *
 * @param entity - any object carrying the {@link LifecycleFields} (Resource/Client/Project).
 * @returns the derived state: `'deleted'` if `deletedAt` is set, else `'archived'` if `archivedAt`
 *          is valid, else `'active'`. Malformed legacy tombstones are ignored so the row derives
 *          to its nearest valid state and can be repaired by its next legal transition.
 */
export function lifecycleStatus(entity: LifecycleFields): LifecycleState {
  if (isValidTombstone(entity.deletedAt)) return "deleted";
  if (isValidTombstone(entity.archivedAt)) return "archived";
  return "active";
}
