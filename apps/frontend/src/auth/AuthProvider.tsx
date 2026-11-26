import { CompanySetup } from './CompanySetup';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { readSoleCompanyOwnership } from './useCompanySummaries';
import { resolvePublicAuthEntry } from './authEntryRoute';
import { useStore } from '@/store/useStore';
import { queryClient } from '@/api/queryClient';
import { masqueradeModel } from './masqueradeModelInstance';
import { AuthContext } from './authContext';
import { m } from '@/i18n';
import { Button } from '@/components/ui/button';
import { AUTH_INVALIDATION_STORAGE_KEY, signOutAndReload } from './signOut';
import { APP_NAME } from '@capacitylens/shared/brand';
import type { AuthStatusResult } from './authStatus';
import { fetchAuthStatus } from './fetchAuthStatus';
import { AuthLoading } from './authScreens';
import { AccessScreen } from './AccessScreens';
import { useAuthContextValue } from './useAuthContextValue';

// Auth gate checks GET /api/v1/auth/me once at boot; a 401 replaces everything with the SignInScreen. The screen is a
// lazy chunk so interactive auth forms never load unless a sign-in is actually shown.

const SignInScreen = lazy(() =>
  import('./SignInScreen').then((screenModule) => ({ default: screenModule.SignInScreen })),
);

type CheckAuth = (onNull: 'report-error' | 'keep-previous') => Promise<AuthStatusResult | null>;

function useCompanyAccessReady(status: AuthStatusResult, onCompanyAccessReady?: () => void) {
  const companyAccessSignalled = useRef(false);
  const ready = status.kind === 'pass' && !status.companySetupRequired && !status.accessGate;
  useEffect(() => {
    if (!ready) {
      companyAccessSignalled.current = false;
      return;
    }
    if (companyAccessSignalled.current) return;
    companyAccessSignalled.current = true;
    onCompanyAccessReady?.();
  }, [onCompanyAccessReady, ready]);
}

function useAuthStatus() {
  const [status, setStatus] = useState<AuthStatusResult>({ kind: 'checking' });
  const authRequestSeq = useRef(0);
  const checkAuth: CheckAuth = useCallback(async (onNull) => {
    const requestId = ++authRequestSeq.current;
    const next = await fetchAuthStatus(() => requestId === authRequestSeq.current);
    if (requestId !== authRequestSeq.current) return null;
    if (next === null || (next.kind === 'error' && onNull === 'keep-previous')) {
      if (next?.kind === 'error' && onNull === 'keep-previous') {
        console.warn(
          'AuthProvider: /api/v1/auth/me refresh failed; keeping the previous auth snapshot',
        );
      }
      return next;
    }
    if (next.kind === 'signIn') {
      masqueradeModel.invalidate();
      queryClient.clear();
      useStore.getState().clearPlanning();
    }
    setStatus(next);
    return next;
  }, []);
  const refreshAuth = useCallback(async () => {
    await checkAuth('keep-previous');
  }, [checkAuth]);
  return { status, setStatus, checkAuth, refreshAuth };
}

function useAuthRevalidation({
  planningAuthLossVersion,
  checkAuth,
  refreshAuth,
}: {
  planningAuthLossVersion: number;
  checkAuth: CheckAuth;
  refreshAuth: () => Promise<void>;
}) {
  useEffect(() => {
    void checkAuth('report-error');
  }, [checkAuth]);
  const previousAuthLossVersion = useRef(planningAuthLossVersion);
  useEffect(() => {
    if (planningAuthLossVersion !== previousAuthLossVersion.current) {
      void refreshAuth();
    }
    previousAuthLossVersion.current = planningAuthLossVersion;
  }, [planningAuthLossVersion, refreshAuth]);
  useEffect(() => {
    const revalidateVisibleSession = () => {
      if (document.visibilityState !== 'visible') return;
      // A returning tab must reconcile its planning revision after identity has been checked.
      // A refused identity clears the private cache in checkAuth, so it cannot start a read.
      void checkAuth('keep-previous').then((next) => {
        if (next?.kind === 'pass' && useStore.getState().activeCompanyId !== null) {
          return useStore.getState().refreshPlanning();
        }
      });
    };
    window.addEventListener('focus', revalidateVisibleSession);
    document.addEventListener('visibilitychange', revalidateVisibleSession);
    const interval = window.setInterval(() => {
      if (useStore.getState().activeCompanyId !== null) revalidateVisibleSession();
    }, 60_000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', revalidateVisibleSession);
      document.removeEventListener('visibilitychange', revalidateVisibleSession);
    };
  }, [checkAuth]);
}

function useAuthInvalidation({
  checkAuth,
  setStatus,
}: {
  checkAuth: CheckAuth;
  setStatus: (status: AuthStatusResult) => void;
}) {
  useEffect(() => {
    const resetOnAuthInvalidation = (event: StorageEvent) => {
      if (event.key !== AUTH_INVALIDATION_STORAGE_KEY) return;
      masqueradeModel.invalidate();
      queryClient.clear();
      useStore.getState().clearPlanning();
      setStatus({ kind: 'checking' });
      void checkAuth('report-error');
    };
    window.addEventListener('storage', resetOnAuthInvalidation);
    return () => window.removeEventListener('storage', resetOnAuthInvalidation);
  }, [checkAuth, setStatus]);
}

function SignInGate({
  status,
  children,
  authContextValue,
}: {
  status: Extract<AuthStatusResult, { kind: 'signIn' }>;
  children: ReactNode;
  authContextValue: ReturnType<typeof useAuthContextValue>;
}) {
  const publicEntry = resolvePublicAuthEntry(window.location.pathname);
  if (publicEntry === 'password-reset') return <>{children}</>;
  if (publicEntry === 'invitation' || publicEntry === 'email-verification') {
    return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
  }
  return (
    <Suspense fallback={<AuthLoading message={m.auth_loading_sign_in()} />}>
      <SignInScreen
        needsSetup={status.needsSetup}
        passwordResetEmail={status.passwordResetEmail}
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

function AuthenticatedGate({
  children,
  authContextValue,
}: {
  children: ReactNode;
  authContextValue: ReturnType<typeof useAuthContextValue>;
}) {
  return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
}
/** Provides server-verified authentication state and a retryable boot gate. Unresolved later checks preserve the current snapshot, while a confirmed 401 opens sign-in. */
export function AuthProvider({
  children,
  onCompanyAccessReady,
}: {
  children: ReactNode;
  /** Starts company-data hydration after /me admits access; the callback must be idempotent under StrictMode effect replay. */
  onCompanyAccessReady?: () => void;
}) {
  return (
    <AuthenticatedAppProvider {...(onCompanyAccessReady ? { onCompanyAccessReady } : {})}>
      {children}
    </AuthenticatedAppProvider>
  );
}

function AuthenticatedAppProvider({
  children,
  onCompanyAccessReady,
}: {
  children: ReactNode;
  onCompanyAccessReady?: () => void;
}) {
  const planningAuthLossVersion = useStore((state) => state.planningAuthLossVersion);
  const { status, setStatus, checkAuth, refreshAuth } = useAuthStatus();
  useCompanyAccessReady(status, onCompanyAccessReady);
  useAuthRevalidation({ planningAuthLossVersion, checkAuth, refreshAuth });
  useAuthInvalidation({ checkAuth, setStatus });

  useEffect(() => {
    if (status.kind === 'error') {
      document.title = `${m.auth_verify_session_failed()} · ${APP_NAME}`;
    }
  }, [status.kind]);

  const signOut = useCallback(async () => {
    await signOutAndReload();
  }, []);

  const authContextValue = useAuthContextValue(status, refreshAuth, signOut);

  if (status.kind === 'checking') return <AuthLoading message={m.auth_checking_session()} />;
  if (status.kind === 'error') {
    return (
      <AuthError
        message={status.message}
        retry={() => {
          setStatus({ kind: 'checking' });
          void checkAuth('report-error');
        }}
      />
    );
  }
  if (status.kind === 'signIn') {
    return (
      <SignInGate status={status} authContextValue={authContextValue}>
        {children}
      </SignInGate>
    );
  }
  // The address confirmation page stays reachable from the limited screen that asks for it.
  const confirmingAddress =
    status.accessGate === 'verify-email' &&
    resolvePublicAuthEntry(window.location.pathname) === 'email-verification';
  if (status.accessGate && !confirmingAddress) {
    return (
      <AccessScreen
        gate={status.accessGate}
        user={status.user}
        {...(status.admission ? { admission: status.admission } : {})}
        onSignOut={signOut}
        onRefresh={async () => {
          await checkAuth('report-error');
        }}
      />
    );
  }
  if (confirmingAddress) {
    return <AuthenticatedGate authContextValue={authContextValue}>{children}</AuthenticatedGate>;
  }
  if (status.companySetupRequired) {
    return (
      <CompanySetup
        onSignOut={signOut}
        onConflict={async () => {
          // A conflict may be another tab's success or an installation that this identity cannot own.
          if (!(await readSoleCompanyOwnership())) return false;
          const next = await checkAuth('report-error');
          if (!next || next.kind !== 'pass' || next.companySetupRequired) {
            throw new Error('Could not refresh company access. Refresh the page to try again.');
          }
          return true;
        }}
        onCreated={async () => {
          const next = await checkAuth('report-error');
          if (
            !next ||
            next.kind === 'error' ||
            (next.kind === 'pass' && next.companySetupRequired)
          ) {
            throw new Error('Company created; session refresh failed. Try refreshing the page.');
          }
        }}
      />
    );
  }
  return <AuthenticatedGate authContextValue={authContextValue}>{children}</AuthenticatedGate>;
}
