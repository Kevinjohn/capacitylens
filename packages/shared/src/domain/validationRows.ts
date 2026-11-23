import type { Allocation, AppData, AppDataKey, ID, ScopedEntity } from '../types/entities.js';
import type { ValidationResult } from '../lib/integrity.js';
import { isInCompany } from './companyBoundary.js';
import { throwDomainError } from './errors.js';
import { inspectLifecycleAncestry, resolveLifecycleStatus } from './lifecycle.js';
import type { LifecycleAncestryRow, LifecycleFields } from './lifecycle.js';

interface ValidationRowOptions {
  data: AppData;
  table: AppDataKey;
  id: ID;
}

interface OwnedRowOptions {
  data: AppData;
  table: AppDataKey;
  id: ID;
  companyId: ID;
}

interface ValidationAllocationsForOptions {
  data: AppData;
  companyId: ID;
  side: 'resource' | 'activity';
  id: ID;
}

interface IsEffectivelyActiveOptions {
  data: AppData;
  table: AppDataKey;
  row: LifecycleFields & { id: ID };
}

/** Find a row by table and id in `data`. Pure. */
export const resolveValidationRow = ({
  data,
  table,
  id,
}: ValidationRowOptions): (Record<string, unknown> & { id: ID }) | undefined =>
  (data[table] as unknown as (Record<string, unknown> & { id: ID })[]).find((row) => row.id === id);

/** Fetch a row and narrow it to this company in one step. An absent row and a cross-company row both
 * read as `undefined`, so every caller keeps its own domain-specific refusal message. */
export const resolveOwnedRow = <T extends ScopedEntity>({
  data,
  table,
  id,
  companyId,
}: OwnedRowOptions): T | undefined => {
  const row = resolveValidationRow({ data, table, id }) as T | undefined;
  return row && isInCompany(row, companyId) ? row : undefined;
};

/** The company's allocations on one end of the pair, beside {@link resolveValidationRow}. */
export const listValidationAllocations = ({
  data,
  companyId,
  side,
  id,
}: ValidationAllocationsForOptions): readonly Allocation[] =>
  data.allocations.filter(
    (allocation) =>
      isInCompany(allocation, companyId) &&
      (side === 'resource' ? allocation.resourceId : allocation.activityId) === id,
  );

/** `codes[0]`/`errors[0]` are guaranteed present: every validator sets ok=false and pushes a message
 * in the same step, so `!validation.ok` always implies non-empty arrays. (Documented coupling between
 * ValidationResult.ok and errors, don't split the two without revisiting this read.) */
export const assertValid = (validation: ValidationResult): void => {
  if (validation.ok) return;
  const code = validation.codes[0];
  const message = validation.errors[0];
  if (code === undefined || message === undefined) {
    throw new Error('Invalid validation result must include a code and message.');
  }
  throwDomainError(code, message);
};

/** Match normal-read lifecycle closure at the shared active-write boundary. Inactive rows or
 * ancestors return false; missing, malformed or cross-company ancestors do not imply lifecycle
 * state and are handled separately by integrity validation. */
export const isEffectivelyActive = ({ data, table, row }: IsEffectivelyActiveOptions): boolean =>
  resolveLifecycleStatus(row) === 'active' &&
  inspectLifecycleAncestry(
    table,
    // The one named seam for the single cast the ancestry walk needs: an interface-typed entity
    // carries no implicit index signature, so TypeScript can't see it as the loose
    // LifecycleAncestryRow the walk reads by field name. Every field the walk touches
    // (id / companyId / tombstones / FK ids) is present on these rows.
    row as unknown as LifecycleAncestryRow,
    (parentTable, id) => resolveValidationRow({ data, table: parentTable, id }),
  ).kind === 'visible';
