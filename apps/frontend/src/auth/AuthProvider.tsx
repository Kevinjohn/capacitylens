import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isServerConfigured } from "@/data/apiConfig";
import { bindStoredAccountCommandsToIdentity, clearStoredAccountCommands } from "@/account/accountClient";
import { resolvePublicAuthEntry } from "./authEntryRoute";
import { useStore } from "@/store/useStore";
import { AuthContext } from "./authContext";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import { AUTH_INVALIDATION_STORAGE_KEY, signOutAndReload } from "./signOut";
import { APP_NAME } from "@capacitylens/shared/brand";
import { buildOpenAuthResult } from "./authStatus";
import type { AuthStatusResult } from "./authStatus";
import { fetchAuthStatus } from "./fetchAuthStatus";
import { AuthenticatedExternalSignInFailure, AuthLoading, ReauthMount } from "./authScreens";
import { useAuthContextValue } from "./useAuthContextValue";

// Auth boundary. In the demo build (VITE_CAPACITYLENS_DEMO=1) this is a
// pure pass-through that performs no fetch at all. In server mode (the default) it asks
// GET /api/auth/me once at boot; a 401 replaces everything with the LoginScreen. The screen is a
// lazy chunk so interactive auth forms never load unless a login is actually shown.

const LoginScreen = lazy(() => import("./LoginScreen").then((screenModule) => ({ default: screenModule.LoginScreen })));

type CheckAuth = (onNull: "report-error" | "keep-previous") => Promise<AuthStatusResult | null>;

function useTenantAccessReady(
  status: AuthStatusResult,
  onTenantAccessReady?: (identitySource: "live" | "open") => void,
) {
  const tenantAccessSignalled = useRef(false);
  const ready = status.kind === "pass";
  const identitySource = status.kind === "pass" ? (status.identitySource ?? "open") : "open";
  useEffect(() => {
    if (!ready) {
      tenantAccessSignalled.current = false;
      return;
    }
    if (tenantAccessSignalled.current) return;
    tenantAccessSignalled.current = true;
    onTenantAccessReady?.(identitySource);
  }, [identitySource, onTenantAccessReady, ready]);
}

type UseAuthStatusOptions = { serverMode: boolean };
function useAuthStatus({ serverMode }: UseAuthStatusOptions) {
  const [status, setStatus] = useState<AuthStatusResult>(
    serverMode ? { kind: "checking" } : buildOpenAuthResult("off", null),
  );
  const authRequestSeq = useRef(0);
  const checkAuth: CheckAuth = useCallback(async (onNull) => {
    const requestId = ++authRequestSeq.current;
    const next = await fetchAuthStatus(() => requestId === authRequestSeq.current);
    if (requestId !== authRequestSeq.current) return null;
    if (next === null || (next.kind === "error" && onNull === "keep-previous")) {
      if (next?.kind === "error" && onNull === "keep-previous") {
        console.warn("AuthProvider: /api/auth/me refresh failed; keeping the previous auth snapshot");
      }
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
  return { status, setStatus, checkAuth, refreshAuth };
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
    void checkAuth("report-error");
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

function useAuthInvalidation({
  serverMode,
  checkAuth,
  setStatus,
}: {
  serverMode: boolean;
  checkAuth: CheckAuth;
  setStatus: (status: AuthStatusResult) => void;
}) {
  useEffect(() => {
    if (!serverMode) return;
    const onAuthInvalidation = (event: StorageEvent) => {
      if (event.key !== AUTH_INVALIDATION_STORAGE_KEY) return;
      useStore.getState().setActiveAccount(null);
      setStatus({ kind: "checking" });
      void checkAuth("report-error");
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
  if (publicEntry === "invitation" || publicEntry === "company-join") {
    return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
  }
  return (
    <Suspense fallback={<AuthLoading message={m.auth_loading_sign_in()} />}>
      <LoginScreen
        authMode={status.authMode}
        needsSetup={status.needsSetup}
        passwordResetEmail={status.passwordResetEmail}
        providers={status.providers}
        degraded={status.degraded}
        hadUnsavedChanges={status.hadUnsavedChanges}
        onSignedIn={() => {
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
/** Provides server-verified authentication state and a retryable boot boundary. Demo mode permits access without a request; unresolved later checks preserve the current snapshot, while a confirmed 401 opens sign-in. */
export function AuthProvider({
  children,
  onTenantAccessReady,
}: {
  children: ReactNode;
  /** Starts tenant-data hydration after /me admits access; the callback must be idempotent under StrictMode effect replay. */
  onTenantAccessReady?: (identitySource: "live" | "open") => void;
}) {
  return (
    <AuthenticatedAppProvider {...(onTenantAccessReady ? { onTenantAccessReady } : {})}>
      {children}
    </AuthenticatedAppProvider>
  );
}

function AuthenticatedAppProvider({
  children,
  onTenantAccessReady,
}: {
  children: ReactNode;
  onTenantAccessReady?: (identitySource: "live" | "open") => void;
}) {
  const serverMode = isServerConfigured();
  const persistError = useStore((state) => state.persistError);
  const { status, setStatus, checkAuth, refreshAuth } = useAuthStatus({ serverMode });
  useTenantAccessReady(status, onTenantAccessReady);
  useAuthRevalidation({ serverMode, persistError, checkAuth, refreshAuth });
  useAuthInvalidation({ serverMode, checkAuth, setStatus });

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
          void checkAuth("report-error");
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
  return (
    <AuthenticatedBoundary status={status} authContextValue={authContextValue}>
      {children}
    </AuthenticatedBoundary>
  );
}
