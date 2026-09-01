import { isServerConfigured } from "../data/apiConfig";
import { useStore } from "../store/useStore";

/** The authenticated account-switch boundary. It ends any current read projection before the
 * persistence subscriber installs another account's slice. */
export async function transitionAccount(accountId: string | null): Promise<boolean> {
  if (!isServerConfigured()) {
    useStore.getState().setActiveAccount(accountId);
    return true;
  }
  // Load the controller only when an authenticated transition actually runs. This keeps demo and
  // isolated component tests from initializing the server-persistence owner merely by importing a
  // picker component, and avoids a cycle through the account-summary refresh helper.
  const { masqueradeController } = await import("./masqueradeController");
  return masqueradeController.transitionAccount(accountId);
}

/** Start a server-backed read-only member projection through the lazily loaded transition owner. */
export async function startMasquerade(accountId: string, targetUserId: string): Promise<boolean> {
  const { masqueradeController } = await import("./masqueradeController");
  return masqueradeController.start(accountId, targetUserId);
}
