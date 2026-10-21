import { useMemo } from "react";
import type { AuthContextValue, AuthProviderInfo } from "./authContext";
import type { AuthStatusResult } from "./authStatus";

// A stable (never-reallocated) empty providers array, used as the authContextValue memo's fallback
// for statuses that never actually read it (checking/error), so those renders can't be mistaken by
// the memo's dependency check for a "providers changed" render (a fresh `[]` literal would).
const EMPTY_PROVIDERS: AuthProviderInfo[] = [];

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
  const contextProviders = status.kind === "pass" || status.kind === "login" ? status.providers : EMPTY_PROVIDERS;
  const contextCanCreateAccount = status.kind === "pass" ? status.canCreateAccount : false;
  const contextReauthMethod = status.kind === "pass" ? status.reauthMethod : "password";
  const authContextValue = useMemo(
    () => ({
      authMode: contextAuthMode,
      user: contextUser,
      providers: contextProviders,
      canCreateAccount: contextCanCreateAccount,
      reauthMethod: contextReauthMethod,
      refreshAuth,
      signOut,
    }),
    [
      contextAuthMode,
      contextUser,
      contextProviders,
      contextCanCreateAccount,
      contextReauthMethod,
      refreshAuth,
      signOut,
    ],
  );

  return authContextValue;
}
