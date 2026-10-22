import { useStore } from "@/store/useStore";
import { refreshAccountSummaries } from "./useAccountSummaries";

/** Reload every actor-dependent read model while server writes remain suspended. */
export async function reprojectAccess(accountId: string, includeAccountSummaries = true): Promise<boolean> {
  useStore.getState().invalidateMemberships();
  if (includeAccountSummaries) {
    const summaries = await refreshAccountSummaries({
      preserveActiveAccountIfMissing: true,
    });
    if (summaries === null) return false;
  }
  return useStore.getState().activeAccountId === accountId && useStore.getState().refreshPlanning({ fresh: true });
}
