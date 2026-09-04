import { SCOPED_KEYS, scopedTables } from "../types/entities";
import type { AppData, ID } from "../types/entities";
import { notInAccount } from "./tenancy";

export type { ValidationDataLookup } from "./validationLookup";
export { findOwned, assertScopedRefs, assertAllocationRefs } from "./assertions/refs";
export {
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
} from "./assertions/dependents";
export { remapAndValidateImport } from "./importFold";

// Pure, environment-agnostic domain mutations + integrity assertions extracted
// from the Zustand store so the SAME logic can run on a future server (and be
// unit-tested once, against both). Nothing here touches React / Zustand / DOM /
// browser persistence. The store stays the orchestrator: it resolves the active account
// and owns the clock (id/createdAt/updatedAt); these functions validate refs and
// compute the next AppData. All cascade/transform helpers return a NEW AppData.
//
// Account resolution itself (the "no active account" guard) deliberately stays in
// the store — it reads live UI state. Every function here takes `accountId`
// explicitly so it has no ambient dependency.

/**
 * Cascade-drop an account and every scoped entity belonging to it. Returns a new
 * AppData (mutating a fresh copy in place — scopedTables returns the same ref).
 */
export function deleteAccountCascade(data: AppData, accountId: ID): AppData {
  const next: AppData = {
    ...data,
    accounts: data.accounts.filter((a) => a.id !== accountId),
  };
  const src = scopedTables(data);
  const dst = scopedTables(next);
  for (const key of SCOPED_KEYS) {
    dst[key] = src[key].filter(notInAccount(accountId));
  }
  return next;
}
