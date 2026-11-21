import { clearStoredAccountOperations } from '@/account/accountOperations';
import { queryClient } from '@/api/queryClient';
import { authApi } from './authApi';
import { useStore } from '@/store/useStore';

/** Non-secret storage signal that makes sibling tabs recheck the server session. */
export const AUTH_INVALIDATION_STORAGE_KEY = 'capacitylens/sessionInvalidated';

interface SignOutOptions {
  clearAccountOperations?: () => void;
  reload?: () => void;
}

/** Ends the server session before clearing private state, notifying sibling tabs and reloading.
 * @throws If the request fails, the current screen keeps its state and can offer a retry.
 */
export async function signOutAndReload({
  clearAccountOperations = clearStoredAccountOperations,
  reload = () => window.location.reload(),
}: SignOutOptions = {}): Promise<void> {
  const result = await authApi.signOut();
  if (result.error) throw new Error(result.error.message);

  try {
    queryClient.clear();
    useStore.getState().clearPlanning();
    clearAccountOperations();
  } catch (error) {
    // Local cleanup failure must not keep the signed-out tab open.
    console.error('AuthProvider: could not fully clear signed-out state', error);
  }
  try {
    window.localStorage.setItem(AUTH_INVALIDATION_STORAGE_KEY, crypto.randomUUID());
  } catch (error) {
    // Other tabs also check on focus, so this tab can finish signing out.
    console.warn('AuthProvider: sibling tabs could not be notified about sign-out', error);
  }
  reload();
}
