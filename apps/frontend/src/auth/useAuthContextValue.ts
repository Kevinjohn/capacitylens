import { useMemo } from "react";
import type { AuthContextValue } from "./authContext";
import type { AuthStatusResult } from "./authStatus";

function authModeForStatus(status: AuthStatusResult) {
  if (status.kind === "pass" || status.kind === "login") return status.authMode;
  return "off";
}

/** Builds the auth context value from server status and session actions. */
export function useAuthContextValue(
  status: AuthStatusResult,
  refreshAuth: AuthContextValue["refreshAuth"],
  signOut: AuthContextValue["signOut"],
) {
  // Memoise the shared context value so unrelated auth-boundary renders do not notify every consumer.
  const contextAuthMode = authModeForStatus(status);
  const contextUser = status.kind === "pass" ? status.user : null;
  const contextCanCreateAccount = status.kind === "pass" ? status.canCreateAccount : false;
  const authContextValue = useMemo(
    () => ({
      authMode: contextAuthMode,
      user: contextUser,
      canCreateAccount: contextCanCreateAccount,
      refreshAuth,
      signOut,
    }),
    [contextAuthMode, contextUser, contextCanCreateAccount, refreshAuth, signOut],
  );

  return authContextValue;
}
