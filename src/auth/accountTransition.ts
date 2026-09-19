import type { ClientMasqueradeEndReason, MasqueradeStatus } from "@capacitylens/shared/domain/masquerade";
import { isServerConfigured } from "../data/apiConfig";
import { useStore } from "../store/useStore";

async function loadMasqueradeController() {
  const { masqueradeController } = await import("./masqueradeController");
  return masqueradeController;
}

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
  return (await loadMasqueradeController()).transitionAccount(accountId);
}

/** Start a server-backed read-only member projection through the lazily loaded transition owner. */
export async function startMasquerade(accountId: string, targetUserId: string): Promise<boolean> {
  return (await loadMasqueradeController()).start(accountId, targetUserId);
}

/** Adopt server status without pulling the server transition owner into the application entry chunk. */
export async function adoptMasqueradeStatus(
  status: MasqueradeStatus,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const controller = await loadMasqueradeController();
  if (!isCurrent()) return false;
  controller.adoptStatus(status);
  return true;
}

/** Retry the active read projection through the lazily loaded transition owner. */
export async function retryMasqueradeProjection(): Promise<boolean> {
  return (await loadMasqueradeController()).retryProjection();
}

/** End the active projection through the lazily loaded transition owner. */
export async function endMasquerade(
  reason: ClientMasqueradeEndReason = "explicit",
  navigate?: (to: string) => void,
): Promise<boolean> {
  return (await loadMasqueradeController()).end(reason, navigate);
}
