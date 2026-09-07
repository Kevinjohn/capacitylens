import type { Allocation, AppData, AppDataKey, ID, ScopedEntity } from "../types/entities";
import type { ValidationResult } from "../lib/integrity";
import { belongsToAccount } from "./tenancy";
import { domainError } from "./errors";
import {
  inspectLifecycleAncestry,
  lifecycleStatus,
  type LifecycleAncestryRow,
  type LifecycleFields,
} from "./lifecycle";

/**
 * Optional indexed view used by server batch validation. The browser/store callers keep using the
 * AppData arrays directly; a large transaction can supply these point/reverse lookups so applying
 * many operations does not repeatedly scan the same account slice.
 */
export interface ValidationDataLookup {
  row(table: AppDataKey, id: ID): (Record<string, unknown> & { id: ID }) | undefined;
  allocationsForResource(accountId: ID, resourceId: ID): readonly Allocation[];
  allocationsForActivity(accountId: ID, activityId: ID): readonly Allocation[];
  resourceHasLoadedAllocation(accountId: ID, resourceId: ID): boolean;
  resourceHasTimeOff(accountId: ID, resourceId: ID): boolean;
}

export const resolveValidationRow = (
  data: AppData,
  table: AppDataKey,
  id: ID,
  lookup?: ValidationDataLookup,
): (Record<string, unknown> & { id: ID }) | undefined => {
  if (lookup) return lookup.row(table, id);
  return (data[table] as unknown as (Record<string, unknown> & { id: ID })[]).find((row) => row.id === id);
};

/** Fetch a row and narrow it to THIS account in one step. An ABSENT row and a CROSS-ACCOUNT row both
 * read as `undefined`, so every caller keeps its own domain-specific rejection message. */
export const resolveOwnedRow = <T extends ScopedEntity>(
  data: AppData,
  table: AppDataKey,
  id: ID,
  accountId: ID,
  lookup?: ValidationDataLookup,
): T | undefined => {
  const row = resolveValidationRow(data, table, id, lookup) as T | undefined;
  return row && belongsToAccount(row, accountId) ? row : undefined;
};

/** The account's allocations on ONE end of the pair, beside {@link resolveValidationRow}: the indexed
 * server-batch lookup when a large transaction supplies one, otherwise a scan of the local array. */
export const listValidationAllocations = (
  data: AppData,
  accountId: ID,
  side: "resource" | "activity",
  id: ID,
  lookup?: ValidationDataLookup,
): readonly Allocation[] => {
  if (lookup) {
    return side === "resource"
      ? lookup.allocationsForResource(accountId, id)
      : lookup.allocationsForActivity(accountId, id);
  }
  return data.allocations.filter(
    (allocation) =>
      belongsToAccount(allocation, accountId) &&
      (side === "resource" ? allocation.resourceId : allocation.activityId) === id,
  );
};

/** `codes[0]`/`errors[0]` are guaranteed present: every validator sets ok=false and pushes a message
 * in the same step, so `!validation.ok` always implies non-empty arrays. (Documented coupling between
 * ValidationResult.ok and errors — don't split the two without revisiting this read.) */
export const assertValid = (validation: ValidationResult): void => {
  if (!validation.ok) domainError(validation.codes[0], validation.errors[0]);
};

/** Match normal-read lifecycle closure at the shared active-write boundary. Indexed server batch
 * callers retain O(depth) point lookups; browser/store callers traverse the same bounded graph over
 * their local arrays. Missing/cross-account parents return false and keep each caller's existing
 * domain-specific validation message. */
export const isEffectivelyActive = (
  data: AppData,
  table: AppDataKey,
  row: LifecycleFields & { id: ID },
  lookup?: ValidationDataLookup,
): boolean =>
  lifecycleStatus(row) === "active" &&
  inspectLifecycleAncestry(
    table,
    // The ONE named seam for the single cast the ancestry walk needs: an interface-typed entity
    // carries no implicit index signature, so TypeScript can't see it as the loose
    // LifecycleAncestryRow the walk reads by field name. Every field the walk touches
    // (id / accountId / tombstones / FK ids) is present on these rows.
    row as unknown as LifecycleAncestryRow,
    (parentTable, id) => resolveValidationRow(data, parentTable, id, lookup) as LifecycleAncestryRow | undefined,
  ).visible;
