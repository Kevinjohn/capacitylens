import type { ID, ScopedEntity } from '../types/entities.js';

// The company boundary, in one place. Company isolation is the app's core invariant: every scoped row
// belongs to exactly one company, every read is narrowed to the active company, and every write
// is guarded against a cross-company id. That boundary is a single membership test, written once
// here so a read filter, a write guard, and a cascade can never drift in how they decide "does this
// row belong to company X". This module is a types-only leaf (no runtime deps) so the hot read
// seam (useScopedData) can import it without pulling in the mutation/import machinery.

/** The anchor: does a single, already-located row belong to `companyId`? Every other helper here
 * is defined in terms of this, and the write-boundary guard (getOwned) and the FK-coherence
 * checks (assertScopedRefs) use it directly on one row. */
export const isInCompany = (scopedEntity: ScopedEntity, companyId: ID): boolean =>
  scopedEntity.companyId === companyId;

/** Curried positive predicate for `.filter(...)`: keep only the rows in `companyId`. The read-side
 * seam (useScopedData, scopeData) narrows each table with this. */
export const byCompany =
  (companyId: ID) =>
  (scopedEntity: ScopedEntity): boolean =>
    isInCompany(scopedEntity, companyId);
