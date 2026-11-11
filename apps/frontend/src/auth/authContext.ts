import { createContext, useContext } from 'react';

export type { AccountMode } from '@capacitylens/shared/account/types';
import type { AccountMode } from '@capacitylens/shared/account/types';

/** Verified user identity exposed to authenticated application screens. */
export interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  /** The signed-in identity's image URL, validated server-side; absent when there is none. */
  image?: string | null;
}

/** Authentication state and actions available to app screens. */
export interface AuthContextValue {
  authMode: AccountMode | null;
  user: AuthUser | null;
  /** Rechecks server-owned authentication and company-creation capability. Unresolved refreshes preserve the previous snapshot and log a warning; the promise does not reject, so event callers may discard it. */
  refreshAuth: () => Promise<void>;
  /** Ends the product session and restarts the app. */
  signOut: () => Promise<void>;
}

/** Context supplying authentication state to the application. */
export const AuthContext = createContext<AuthContextValue>({
  authMode: null,
  user: null,
  refreshAuth: async () => {},
  signOut: async () => {},
});

/** Reads authentication state and actions from the nearest auth provider. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
