import { refreshActiveAccountSlice } from "../data/persist";
import { useStore } from "../store/useStore";
import { refreshAccountSummaries } from "./useAccountSummaries";

/** Reload every actor-dependent read model while server writes remain suspended. */
export async function reprojectAccess(accountId: string): Promise<boolean> {
  useStore.getState().invalidateMemberships();
  const summaries = await refreshAccountSummaries({
    allowCachedFallback: false,
    preserveActiveAccountIfMissing: true,
  });
  if (summaries === null) return false;
  return (await refreshActiveAccountSlice(accountId)) === "reloaded";
}
