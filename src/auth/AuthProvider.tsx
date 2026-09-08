import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isServerConfigured } from "../data/apiConfig";
import { bindStoredAccountCommandsToIdentity, clearStoredAccountCommands } from "../account/accountClient";
import { resolvePublicAuthEntry } from "./authEntryRoute";
import { useStore } from "../store/useStore";
import { AuthContext } from "./authContext";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import { OFFLINE_WRITE_BOUNDARY_STORAGE_KEY, revalidateOfflineShell } from "../data/offlineCache";
import { signOutAndReload } from "./signOut";
import { APP_NAME } from "@capacitylens/shared/brand";
import { markCompanyPickerForNextReload } from "../lib/companyPickerEntry";
import { buildOpenAuthResult, type AuthStatusResult } from "./authStatus";
import { fetchAuthStatus } from "./fetchAuthStatus";
import { AuthenticatedExternalSignInFailure, AuthLoading, ReauthMount } from "./authScreens";
import { useAuthContextValue } from "./useAuthContextValue";

// Auth boundary (production plan P3.3). In the demo build (VITE_CAPACITYLENS_DEMO=1) this is a
// pure pass-through that performs NO fetch at all. In server mode (the default) it asks
// GET /api/auth/me once at boot: authMode 'off' (the default deploy) renders the app
// exactly as today; a 401 replaces everything with the LoginScreen. The screen is a
// lazy chunk so better-auth's client never loads unless a login is actually shown.

const LoginScreen = lazy(() => import("./LoginScreen").then((screenModule) => ({ default: screenModule.LoginScreen })));
const MfaEnrollmentScreen = lazy(() =>
  import("./MfaEnrollmentScreen").then((screenModule) => ({
    default: screenModule.MfaEnrollmentScreen,
  })),
);

type CheckAuth = (onNull: "fail-open" | "keep-previous") => Promise<AuthStatusResult | null>;

function useTenantAccessReady(status: AuthStatusResult, onTenantAccessReady?: () => void) {
  const tenantAccessSignalled = useRef(false);
  const ready = status.kind === "pass" && !(status.authMode === "password" && status.mfaRequired);
  useEffect(() => {
    if (!ready) {
      tenantAccessSignalled.current = false;
      return;
    }
    if (tenantAccessSignalled.current) return;
    tenantAccessSignalled.current = true;
    onTenantAccessReady?.();
  }, [onTenantAccessReady, ready]);
}

function useAuthStatus(serverMode: boolean) {
  const [status, setStatus] = useState<AuthStatusResult>(
    serverMode ? { kind: "checking" } : buildOpenAuthResult("off", null),
  );
  const authRequestSeq = useRef(0);
  const checkAuth: CheckAuth = useCallback(async (onNull) => {
    const requestId = ++authRequestSeq.current;
    const next = await fetchAuthStatus(() => requestId === authRequestSeq.current);
    if (requestId !== authRequestSeq.current) return null;
    if (next === null || (next.kind === "error" && onNull === "keep-previous")) {
      if (onNull === "fail-open") setStatus(buildOpenAuthResult("off", null));
      else console.warn("AuthProvider: /api/auth/me refresh failed; keeping the previous auth snapshot");
      return next;
    }
    if (next.kind === "login") clearStoredAccountCommands();
    else if (next.kind === "pass") bindStoredAccountCommandsToIdentity(next.user?.id ?? "auth-off");
    setStatus(next);
    return next;
  }, []);
  const refreshAuth = useCallback(async () => {
    if (serverMode) await checkAuth("keep-previous");
  }, [serverMode, checkAuth]);
  const confirmMfaEnrollment = useCallback(async () => {
    if (!serverMode) return true;
    const next = await checkAuth("keep-previous");
    return next?.kind === "pass" && !next.mfaRequired;
  }, [serverMode, checkAuth]);
  return { status, setStatus, checkAuth, refreshAuth, confirmMfaEnrollment };
}

function useAuthRevalidation({
  serverMode,
  persistError,
  checkAuth,
  refreshAuth,
}: {
  serverMode: boolean;
  persistError: unknown;
  checkAuth: CheckAuth;
  refreshAuth: () => Promise<void>;
}) {
  useEffect(() => {
    if (!serverMode) return;
    void revalidateOfflineShell().finally(() => checkAuth("fail-open"));
  }, [serverMode, checkAuth]);
  useEffect(() => {
    if (serverMode && persistError) void refreshAuth();
  }, [serverMode, persistError, refreshAuth]);
  useEffect(() => {
    if (!serverMode) return;
    const revalidateVisibleSession = () => {
      if (document.visibilityState === "visible") void refreshAuth();
    };
    window.addEventListener("focus", revalidateVisibleSession);
    document.addEventListener("visibilitychange", revalidateVisibleSession);
    return () => {
      window.removeEventListener("focus", revalidateVisibleSession);
      document.removeEventListener("visibilitychange", revalidateVisibleSession);
    };
  }, [serverMode, refreshAuth]);
}

function useAuthInvalidation(serverMode: boolean, checkAuth: CheckAuth, setStatus: (status: AuthStatusResult) => void) {
  useEffect(() => {
    if (!serverMode) return;
    const onAuthInvalidation = (event: StorageEvent) => {
      if (event.key !== OFFLINE_WRITE_BOUNDARY_STORAGE_KEY) return;
      useStore.getState().setActiveAccount(null);
      setStatus({ kind: "checking" });
      void checkAuth("fail-open");
    };
    window.addEventListener("storage", onAuthInvalidation);
    return () => window.removeEventListener("storage", onAuthInvalidation);
  }, [serverMode, checkAuth, setStatus]);
}

function LoginBoundary({
  status,
  children,
  authContextValue,
}: {
  status: Extract<AuthStatusResult, { kind: "login" }>;
  children: ReactNode;
  authContextValue: ReturnType<typeof useAuthContextValue>;
}) {
  const publicEntry = resolvePublicAuthEntry(window.location.pathname);
  if (publicEntry === "password-reset") return <>{children}</>;
  if (publicEntry === "invitation") {
    return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
  }
  return (
    <Suspense fallback={<AuthLoading message={m.auth_loading_sign_in()} />}>
      <LoginScreen
        authMode={status.authMode}
        needsSetup={status.needsSetup}
        providers={status.providers}
        degraded={status.degraded}
        hadUnsavedChanges={status.hadUnsavedChanges}
        onSignedIn={() => {
          markCompanyPickerForNextReload();
          window.location.reload();
        }}
      />
    </Suspense>
  );
}

function AuthError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{m.auth_verify_session_failed()}</h1>
        <p role="alert" className="mt-2 text-muted-foreground">
          {message}
        </p>
        <Button variant="link" className="mt-4" onClick={retry}>
          {m.common_try_again()}
        </Button>
      </div>
    </main>
  );
}

function AuthenticatedBoundary({
  status,
  children,
  authContextValue,
}: {
  status: Extract<AuthStatusResult, { kind: "pass" }>;
  children: ReactNode;
  authContextValue: ReturnType<typeof useAuthContextValue>;
}) {
  const authEnabled = status.authMode !== "off";
  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
      {authEnabled && <AuthenticatedExternalSignInFailure />}
      {status.authMode !== "off" && (
        <ReauthMount
          authMode={status.authMode}
          user={status.user}
          providers={status.providers}
          reauthMethod={status.reauthMethod}
          reauthProviderId={status.reauthProviderId}
        />
      )}
    </AuthContext.Provider>
  );
}
/**
 * Boot-time auth boundary.
 *
 * - DEMO mode (VITE_CAPACITYLENS_DEMO=1): a pure pass-through — performs ZERO fetches, renders children.
 * - SERVER mode (the default): asks GET /api/auth/me ONCE at boot. authMode 'off' (the default deploy) renders
 *   the app as today; a 401 swaps in the lazy LoginScreen; any other failure renders a retryable
 *   authentication error boundary.
 * - Re-checks on `persistError` so an expired session (a 401 on a write) swaps to the login screen
 *   rather than letting writes keep failing silently behind the banner; an UNRESOLVED re-check
 *   keeps the previous snapshot (same policy as refreshAuth — see checkAuth).
 * - Exposes `refreshAuth` on the context so client actions that change what /me reports (org
 *   create/delete → a recomputed canCreateAccount) can re-ask mid-session instead of gating UI
 *   affordances on the boot-time snapshot.
 *
 * `authMode` comes ONLY from the server — there is no client-side auth flag.
 */
export function AuthProvider({
  children,
  onTenantAccessReady,
}: {
  children: ReactNode;
  /** Starts tenant-data hydration only after /me admits this boot. The callback must be idempotent
   * because React development StrictMode deliberately replays effects. */
  onTenantAccessReady?: () => void;
}) {
  const serverMode = isServerConfigured();
  const persistError = useStore((state) => state.persistError);
  const { status, setStatus, checkAuth, refreshAuth, confirmMfaEnrollment } = useAuthStatus(serverMode);
  useTenantAccessReady(status, onTenantAccessReady);
  useAuthRevalidation({ serverMode, persistError, checkAuth, refreshAuth });
  useAuthInvalidation(serverMode, checkAuth, setStatus);

  useEffect(() => {
    if (status.kind === "error") {
      document.title = `${m.auth_verify_session_failed()} · ${APP_NAME}`;
    }
  }, [status.kind]);

  const signOut = useCallback(async () => {
    await signOutAndReload();
  }, []);

  const authContextValue = useAuthContextValue(status, refreshAuth, signOut);

  if (status.kind === "checking") return <AuthLoading message={m.auth_checking_session()} />;
  if (status.kind === "error") {
    return (
      <AuthError
        message={status.message}
        retry={() => {
          setStatus({ kind: "checking" });
          void checkAuth("fail-open");
        }}
      />
    );
  }
  if (status.kind === "login") {
    return (
      <LoginBoundary status={status} authContextValue={authContextValue}>
        {children}
      </LoginBoundary>
    );
  }
  if (status.mfaRequired && status.authMode === "password") {
    return (
      <Suspense fallback={<AuthLoading message={m.auth_loading_sign_in()} />}>
        <MfaEnrollmentScreen
          blockedEntry={resolvePublicAuthEntry(window.location.pathname)}
          onEnrolled={confirmMfaEnrollment}
          onSignOut={() => void signOut()}
        />
      </Suspense>
    );
  }
  return (
    <AuthenticatedBoundary status={status} authContextValue={authContextValue}>
      {children}
    </AuthenticatedBoundary>
  );
}
