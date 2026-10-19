import { clearStoredAccountCommands } from "@/account/accountClient";
import { queryClient } from "@/api/queryClient";
import { authClient } from "./authClient";

/** Non-secret storage signal that makes sibling tabs recheck the server session. */
export const AUTH_INVALIDATION_STORAGE_KEY = "capacitylens/sessionInvalidated";

interface SignOutDependencies {
  clearAccountCommands: () => void;
  requestSignOut: () => Promise<{ ok: boolean; status: number }>;
  reload: () => void;
}

/**
 * End the server session, then reload so the next screen comes from the authentication source of truth.
 */
export async function signOutAndReload(overrides: Partial<SignOutDependencies> = {}): Promise<void> {
  const dependencies: SignOutDependencies = {
    clearAccountCommands: clearStoredAccountCommands,
    requestSignOut: async () => {
      const result = await authClient.signOut();
      return { ok: result.error === null, status: result.error?.status ?? 200 };
    },
    reload: () => window.location.reload(),
    ...overrides,
  };

  // Always reload, success or failure. In-memory tenant data must not outlive the sign-out
  // attempt: the server may have accepted a request whose response was lost. Reloading re-checks
  // /me and either restores the authenticated UI or presents the sign-in wall.
  try {
    // Server query results belong to the outgoing principal and must not survive sign-out.
    queryClient.clear();
    // Clear identity-bound retry ceremonies because sessionStorage survives this tab's mandatory
    // reload and could carry an administrative command into the next session on a shared browser.
    try {
      dependencies.clearAccountCommands();
    } catch (error) {
      console.error("AuthProvider: account commands could not be cleared during sign-out", error);
    }
    const response = await dependencies.requestSignOut();
    if (!response.ok) throw new Error(`Sign-out failed (${response.status}).`);
  } catch (error) {
    console.error("AuthProvider: sign-out failed", error);
  } finally {
    try {
      window.localStorage.setItem(AUTH_INVALIDATION_STORAGE_KEY, crypto.randomUUID());
    } catch (error) {
      console.warn("AuthProvider: sibling tabs could not be notified about sign-out", error);
    }
    dependencies.reload();
  }
}
