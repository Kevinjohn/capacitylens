import { SCOPED_KEYS, scopedTables } from "../types/entities";
import type { AppData, ID } from "../types/entities";
import { belongsToAccount } from "./tenancy";

export type { ValidationDataLookup } from "./validationLookup";
export { getOwned, assertScopedRefs, assertAllocationRefs } from "./assertions/refs";
export {
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
} from "./assertions/dependents";
export { remapAndValidateImport } from "./importFold";
export {
  assertAllocationWithinResourceAvailability,
  validateResourceAvailabilityPair,
  type ResourceAvailabilityInput,
} from "./resourceAvailability";

// Domain mutations and integrity checks are pure and independent of the UI store.
// The store resolves the active account and owns IDs and timestamps. Each mutation receives
// accountId explicitly and returns a new AppData.

/**
 * Cascade-drop an account and every scoped entity belonging to it. Returns a new
 * AppData (mutating a fresh copy in place, scopedTables returns the same ref).
 */
export function deleteAccountCascade(data: AppData, accountId: ID): AppData {
  const next: AppData = {
    ...data,
    accounts: data.accounts.filter((account) => account.id !== accountId),
  };
  const sourceTables = scopedTables(data);
  const destinationTables = scopedTables(next);
  for (const key of SCOPED_KEYS) {
    destinationTables[key] = sourceTables[key].filter((scopedEntity) => !belongsToAccount(scopedEntity, accountId));
  }
  return next;
}
