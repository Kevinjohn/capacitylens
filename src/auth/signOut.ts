import { accountClient, clearStoredAccountCommands } from "../account/accountClient";
import { clearOfflineDataForCurrentUser, setOfflineReadEnabled } from "../data/offlineCache";

export const SIGN_OUT_CLEANUP_TIMEOUT_MS = 3_000;

interface SignOutDependencies {
  clearAccountCommands: () => void;
  clearOfflineData: () => Promise<void>;
  disableOfflineRead: () => Promise<void>;
  requestSignOut: () => Promise<{ ok: boolean; status: number }>;
  reload: () => void;
  cleanupTimeoutMs: number;
}

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Offline sign-out cleanup did not finish within ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Clear browser-only account data, end the server session, then unconditionally reload from the
 * authentication source of truth. The cleanup deadline is deliberately shorter than the API
 * request deadline: browser storage must never be able to strand the sign-out control forever.
 */
export async function signOutAndReload(overrides: Partial<SignOutDependencies> = {}): Promise<void> {
  const dependencies: SignOutDependencies = {
    clearAccountCommands: clearStoredAccountCommands,
    clearOfflineData: clearOfflineDataForCurrentUser,
    disableOfflineRead: () => setOfflineReadEnabled(false),
    requestSignOut: () => accountClient.signOut(),
    reload: () => window.location.reload(),
    cleanupTimeoutMs: SIGN_OUT_CLEANUP_TIMEOUT_MS,
    ...overrides,
  };

  // ALWAYS reload — success OR failure. In-memory tenant data must not outlive the sign-out
  // attempt: the server may have accepted a request whose response was lost. Reloading re-checks
  // /me and either restores the authenticated UI or presents the sign-in wall.
  try {
    // End identity-bound retry ceremonies synchronously. Unlike IndexedDB, sessionStorage survives
    // this tab's mandatory reload and could otherwise carry an administrative command into the
    // next session on a shared browser.
    try {
      dependencies.clearAccountCommands();
    } catch (error) {
      console.error("AuthProvider: account commands could not be cleared during sign-out", error);
    }
    try {
      await withTimeout(dependencies.clearOfflineData(), dependencies.cleanupTimeoutMs);
    } catch (error) {
      console.error("AuthProvider: offline data could not be cleared during sign-out", error);
      // setOfflineReadEnabled(false) removes the opt-in synchronously before its first await. Do
      // not let its best-effort IndexedDB/service-worker cleanup become a second sign-out blocker.
      try {
        void dependencies.disableOfflineRead().catch((disableError: unknown) => {
          console.error("AuthProvider: offline access could not be disabled after cleanup failed", disableError);
        });
      } catch (disableError) {
        console.error("AuthProvider: offline access could not be disabled after cleanup failed", disableError);
      }
    }
    const response = await dependencies.requestSignOut();
    if (!response.ok) throw new Error(`Sign-out failed (${response.status}).`);
  } catch (error) {
    console.error("AuthProvider: sign-out failed", error);
  } finally {
    dependencies.reload();
  }
}
