import { SCOPED_KEYS, scopedTables } from "../types/entities.js";
import type { AppData, ID } from "../types/entities.js";
import { belongsToAccount } from "./tenancy.js";

export type { ValidationDataLookup } from "./validationLookup.js";
export { getOwned, assertScopedRefs, assertAllocationRefs } from "./assertions/refs.js";
export {
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
} from "./assertions/dependents.js";
export { remapAndValidateImport } from "./importFold.js";
export {
  assertAllocationWithinResourceAvailability,
  validateResourceAvailabilityPair,
  type ResourceAvailabilityInput,
} from "./resourceAvailability.js";

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
