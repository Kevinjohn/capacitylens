import { byAccount } from "@capacitylens/shared/domain/tenancy";
import { emptyAppData, scopedTables, SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import type { AppData, ID } from "@capacitylens/shared/types/entities";

/** Narrow the full store data to a single account: every scoped array filtered to
 * `accountId`, and `accounts` blanked (scoped views never read the tenant list).
 *
 * This is the read-side tenancy boundary, and its correctness rests on a non-local fact:
 * `SCOPED_KEYS` must be exhaustive over AppData's scoped tables. `scoped` starts as emptyAppData()
 * and only the SCOPED_KEYS are copied across, so a scoped table that AppData gains but SCOPED_KEYS
 * omits would render empty in every scoped view (the rows silently vanish). The exhaustiveness gate
 * shared/types/entities.ts keeps SCOPED_KEYS complete; never add a scoped table without it. */
export function scopeData(data: AppData, accountId: ID): AppData {
  const scoped = emptyAppData();
  const sourceTables = scopedTables(data);
  const destinationTables = scopedTables(scoped);
  for (const key of SCOPED_KEYS) {
    destinationTables[key] = sourceTables[key].filter(byAccount(accountId));
  }
  return scoped;
}
