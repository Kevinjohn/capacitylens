import { useMemo } from "react";
import type { AuthContextValue, AuthProviderInfo } from "./authContext";
import type { Status } from "./authStatus";

// A stable (never-reallocated) empty providers array — used as the authContextValue memo's fallback
// for statuses that never actually read it (checking/error), so those renders can't be mistaken by
// the memo's dependency check for a "providers changed" render (a fresh `[]` literal would).
const EMPTY_PROVIDERS: AuthProviderInfo[] = [];

export function useAuthContextValue(
  status: Status,
  refreshAuth: AuthContextValue["refreshAuth"],
  signOut: AuthContextValue["signOut"],
) {
  // Memoise the context value the same way PermissionProvider.tsx does: AuthContext.Provider would
  // otherwise get a fresh object literal every render, re-rendering every consumer (AppSidebar,
  // SettingsView, the picker, ...) on any unrelated AuthProvider re-render (e.g. persistError
  // toggling). The two AuthContext.Provider sites below (the pre-session invitation carve-out and
  // the authenticated tree) share this ONE computation — each branch's fields are picked from
  // `status` (or hardcoded, matching exactly what that branch always rendered) here, ABOVE the
  // early returns, so the hook itself is called unconditionally on every render (Rules of Hooks).
  const contextAuthMode = status.kind === "pass" ? status.authMode : status.kind === "login" ? status.authMode : "off";
  const contextUser = status.kind === "pass" ? status.user : null;
  const contextProviders = status.kind === "pass" || status.kind === "login" ? status.providers : EMPTY_PROVIDERS;
  const contextCanCreateAccount = status.kind === "pass" ? status.canCreateAccount : false;
  const contextMultiAccount = status.kind === "pass" ? status.multiAccount : false;
  const authContextValue = useMemo(
    () => ({
      authMode: contextAuthMode,
      user: contextUser,
      providers: contextProviders,
      canCreateAccount: contextCanCreateAccount,
      multiAccount: contextMultiAccount,
      refreshAuth,
      signOut,
    }),
    [
      contextAuthMode,
      contextUser,
      contextProviders,
      contextCanCreateAccount,
      contextMultiAccount,
      refreshAuth,
      signOut,
    ],
  );

  return authContextValue;
}
