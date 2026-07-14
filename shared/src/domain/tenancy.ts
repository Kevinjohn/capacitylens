import type { ID, ScopedEntity } from '../types/entities'

// THE tenant boundary, in one place. Multi-tenancy is the app's core invariant: every scoped row
// belongs to exactly one account, every read is narrowed to the active account, and every write
// is guarded against a cross-account id. That boundary is a single membership test — written ONCE
// here so a read filter, a write guard, and a cascade can never drift in how they decide "does this
// row belong to account X". This module is a types-only leaf (no runtime deps) so the hot read
// seam (useScopedData) can import it without pulling in the mutation/import machinery.

/** The anchor: does a single, already-located row belong to `accountId`? Every other helper here
 *  is defined in terms of this, and the write-boundary guard (findOwned) and the FK-coherence
 *  checks (assertScopedRefs) use it directly on one row. */
export const belongsToAccount = (entity: ScopedEntity, accountId: ID): boolean =>
  entity.accountId === accountId

/** Curried positive predicate for `.filter(...)`: keep only the rows IN `accountId`. The read-side
 *  seam (useScopedData, scopeData) narrows each table with this. */
export const byAccount =
  (accountId: ID) =>
  (entity: ScopedEntity): boolean =>
    belongsToAccount(entity, accountId)

/** Curried complement predicate for `.filter(...)`: keep the rows NOT in `accountId` — i.e. drop
 *  that account's rows while preserving every OTHER account's. Cascade-delete-account, clear,
 *  and replace-import use this to remove exactly one tenant's slice. */
export const notInAccount =
  (accountId: ID) =>
  (entity: ScopedEntity): boolean =>
    !belongsToAccount(entity, accountId)
