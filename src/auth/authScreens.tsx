import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { AuthProviderInfo, AuthUser } from "./authContext";
import { reauthPending, resolveReauth, subscribeReauth } from "./reauthCoordinator";
import {
  clearExternalSignInError,
  externalSignInErrorCode,
  externalSignInErrorMessage,
  hasExternalSignInError,
} from "./externalSignInError";
import { useStore } from "../store/useStore";
import { m } from "@/i18n";

// Lazy so Better Auth's client (pulled in by ReauthDialog) never enters the main bundle — the same
// discipline as LoginScreen. The step-up dialog only exists in an auth-on session that hits a
// SESSION_NOT_FRESH 403 (DEFECT B).
const ReauthDialog = lazy(() => import("./ReauthDialog").then((m) => ({ default: m.ReauthDialog })));

/** Bridges the module-level re-auth coordinator (reauthCoordinator.ts) into React: subscribes to the
 *  pending flag via useSyncExternalStore and, while a SESSION_NOT_FRESH step-up is pending, renders
 *  the lazy ReauthDialog. Mounted INSIDE the authenticated provider (and only in auth-on, never
 *  'off') so it always has the live session's authMode/user/providers — auth-off never receives a
 *  freshness 403, so it needs no step-up UI. */
export function ReauthMount({
  authMode,
  user,
  providers,
  reauthMethod,
  reauthProviderId,
}: {
  authMode: "password" | "sso";
  user: AuthUser | null;
  providers: AuthProviderInfo[];
  reauthMethod: "password" | "provider";
  reauthProviderId: string | null;
}) {
  const pending = useSyncExternalStore(subscribeReauth, reauthPending);
  // This host exists only while the authenticated subtree is rendered. A concurrent 401 or
  // mandatory-MFA transition removes it; settle every outside-React waiter before disappearing.
  useEffect(() => () => resolveReauth(false), []);
  if (!pending) return null;
  return (
    <Suspense fallback={<AuthLoading message={m.auth_loading_confirmation()} overlay />}>
      <ReauthDialog
        authMode={authMode}
        user={user}
        providers={providers}
        reauthMethod={reauthMethod}
        reauthProviderId={reauthProviderId}
      />
    </Suspense>
  );
}

export function AuthLoading({ message, overlay = false }: { message: string; overlay?: boolean }) {
  const status = (
    <p
      role="status"
      aria-live="polite"
      className="rounded-md bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm"
    >
      {message}
    </p>
  );
  return overlay ? (
    <div className="fixed inset-0 z-(--z-index-modal) flex items-center justify-center bg-black/40 p-6">{status}</div>
  ) : (
    <main className="flex min-h-screen items-center justify-center p-6">{status}</main>
  );
}

/** Consume an OIDC failure that returned to an already-authenticated product route. Signed-out and
 * invitation routes own the same marker in their local surfaces; this host covers step-up failures,
 * where the existing session means the login wall is intentionally not rendered. */
export function AuthenticatedExternalSignInFailure() {
  const [failed] = useState(() => hasExternalSignInError(window.location.href));
  const [failureCode] = useState(() => externalSignInErrorCode(window.location.href));
  const setNotice = useStore((state) => state.setNotice);

  useEffect(() => {
    if (!failed) return;
    window.history.replaceState(window.history.state, "", clearExternalSignInError(window.location.href));
    setNotice(externalSignInErrorMessage(failureCode), "error");
  }, [failed, failureCode, setNotice]);

  return null;
}
