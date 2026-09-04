import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isServerConfigured } from "../data/apiConfig";
import { bindStoredAccountCommandsToIdentity, clearStoredAccountCommands } from "../account/accountClient";
import { publicAuthEntryForPath } from "./authEntryRoute";
import { useStore } from "../store/useStore";
import { AuthContext } from "./authContext";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import { OFFLINE_WRITE_BOUNDARY_STORAGE_KEY, revalidateOfflineShell } from "../data/offlineCache";
import { signOutAndReload } from "./signOut";
import { APP_NAME } from "@capacitylens/shared/brand";
import { markCompanyPickerForNextReload } from "../lib/companyPickerEntry";
import { passOpen, type Status } from "./authStatus";
import { fetchAuthStatus } from "./fetchAuthStatus";
import { AuthenticatedExternalSignInFailure, AuthLoading, ReauthMount } from "./authScreens";
import { useAuthContextValue } from "./useAuthContextValue";

// Auth boundary (production plan P3.3). In the demo build (VITE_CAPACITYLENS_DEMO=1) this is a
// pure pass-through that performs NO fetch at all. In server mode (the default) it asks
// GET /api/auth/me once at boot: authMode 'off' (the default deploy) renders the app
// exactly as today; a 401 replaces everything with the LoginScreen. The screen is a
// lazy chunk so better-auth's client never loads unless a login is actually shown.

const LoginScreen = lazy(() => import("./LoginScreen").then((m) => ({ default: m.LoginScreen })));
const MfaEnrollmentScreen = lazy(() =>
  import("./MfaEnrollmentScreen").then((m) => ({
    default: m.MfaEnrollmentScreen,
  })),
);
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
  const [status, setStatus] = useState<Status>(
    // Demo build: no server, no cap — canCreateAccount/multiAccount fail open to true (passOpen).
    serverMode ? { kind: "checking" } : passOpen("off", null),
  );
  const persistError = useStore((s) => s.persistError);
  const tenantAccessSignalled = useRef(false);

  const tenantAccessReady = status.kind === "pass" && !(status.authMode === "password" && status.mfaRequired);
  useEffect(() => {
    if (!tenantAccessReady) {
      tenantAccessSignalled.current = false;
      return;
    }
    if (tenantAccessSignalled.current) return;
    tenantAccessSignalled.current = true;
    onTenantAccessReady?.();
  }, [onTenantAccessReady, tenantAccessReady]);

  // Ordering guard for EVERY setStatus-from-fetch path (boot, refreshAuth, the persistError
  // re-check): a monotonically increasing request id, captured when a /me fetch starts. Without it,
  // a slow, earlier request resolving LATE could overwrite a newer result — e.g. a stale
  // authenticated snapshot landing on top of a fresh 401 would hide the login screen and strand the
  // user on a dead session ("changes aren't saving") until a manual reload. Only the latest request
  // may write; a superseded result is simply dropped (the newer request already told the truth).
  const authRequestSeq = useRef(0);

  /** The ONE path from a /me fetch to setStatus, so no two checks can interleave badly (see
   *  `authRequestSeq`). `onNull` picks the degrade when the check resolves nothing trustworthy:
   *  - 'fail-open' is retained as the historical label for boot; explicit error statuses still
   *    render the auth error boundary and are never converted to auth-off.
   *  - 'keep-previous' (every mid-session re-check): keep the current snapshot with a warn
   *    breadcrumb — stale beats resetting a live session's user/authMode to 'off'. */
  const checkAuth = useCallback((onNull: "fail-open" | "keep-previous"): Promise<Status | null> => {
    const requestId = ++authRequestSeq.current;
    // .then (not await) so setStatus runs in a plain callback — the same shape as subscribing to
    // an external system, which is what this is (react-hooks/set-state-in-effect is happy with it).
    return fetchAuthStatus(() => requestId === authRequestSeq.current).then((next) => {
      if (requestId !== authRequestSeq.current) return null; // superseded by a newer check — drop, don't clobber
      if (next === null || (next.kind === "error" && onNull === "keep-previous")) {
        if (onNull === "fail-open") {
          setStatus(passOpen("off", null));
        } else {
          console.warn("AuthProvider: /api/auth/me refresh failed; keeping the previous auth snapshot");
        }
        return next;
      }
      if (next.kind === "login") {
        clearStoredAccountCommands();
      } else if (next.kind === "pass") {
        bindStoredAccountCommandsToIdentity(next.user?.id ?? "auth-off");
      }
      setStatus(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!serverMode) return; // demo build: no auth request, ever
    // Boot failures resolve to an explicit error boundary; only a valid auth-off response opens app.
    void revalidateOfflineShell().finally(() => checkAuth("fail-open"));
  }, [serverMode, checkAuth]);

  // Mid-session re-ask, exposed on the context as `refreshAuth` (see authContext.ts): the server
  // recomputes canCreateAccount per request from MUTABLE state (account count + membership roles),
  // so client actions that change that state (org create/delete in AccountPicker) call this to keep
  // the picker's affordances honest — e.g. deleting the only company must re-surface the "New
  // company" button (the zero-accounts bootstrap exemption) without a manual reload. TOTAL — never
  // rejects: an unresolved refresh keeps the PREVIOUS snapshot with a warn breadcrumb, mirroring
  // the fail-open posture above (the server 403 stays the real enforcer), so callers may safely
  // `void refreshAuth()`.
  const refreshAuth = useCallback(async () => {
    if (!serverMode) return; // demo build: no server, the fields already fail open to true
    await checkAuth("keep-previous");
  }, [serverMode, checkAuth]);

  const confirmMfaEnrollment = useCallback(async () => {
    if (!serverMode) return true;
    const next = await checkAuth("keep-previous");
    return next?.kind === "pass" && !next.mfaRequired;
  }, [serverMode, checkAuth]);

  // P3.4: a failing write raises the persistError banner; when the cause is an expired
  // session the re-check sees the 401 and swaps to the login screen, instead of letting
  // writes keep failing silently behind the banner. Same policy as refreshAuth: when the
  // re-check itself can't resolve /me (null) it KEEPS the current snapshot — a server outage
  // is exactly when /me is unreachable, and resetting a live authenticated session to
  // auth-off would drop the sign-out affordance and reshape member-management mid-outage,
  // with nothing to put it back until a manual reload (this effect only re-runs on
  // persistError transitions). Only a real answer (a 401, a fresh 'pass') changes state.
  useEffect(() => {
    if (!serverMode || !persistError) return;
    void refreshAuth();
  }, [serverMode, persistError, refreshAuth]);

  // Session cookies are shared between tabs, but React state is not. Re-check when a dormant tab
  // becomes observable again so a sign-out, revocation or role change completed elsewhere cannot
  // leave this tab presenting its old authenticated shell indefinitely. The request sequence above
  // makes simultaneous focus/visibility notifications harmless.
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

  // A sibling tab can end the shared cookie session while this tab is backgrounded. Hide tenant
  // state immediately on the storage signal, then resolve the new identity through the normal wall.
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
  }, [serverMode, checkAuth]);

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
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">{m.auth_verify_session_failed()}</h1>
          <p role="alert" className="mt-2 text-muted-foreground">
            {status.message}
          </p>
          <Button
            variant="link"
            className="mt-4"
            onClick={() => {
              setStatus({ kind: "checking" });
              void checkAuth("fail-open");
            }}
          >
            {m.common_try_again()}
          </Button>
        </div>
      </main>
    );
  }
  if (status.kind === "login") {
    // Computed only where it's actually read (this branch and the mfaRequired branch below) —
    // a pure, cheap read of window.location.pathname, so recomputing it per branch is fine.
    const publicEntry = publicAuthEntryForPath(window.location.pathname);
    // Pre-session carve-out (P1.18): /reset-password/:token must render WITHOUT a session — the
    // visitor redeeming an admin-issued reset link is exactly the person who cannot sign in (the
    // login wall would be a dead end). The page is as safe as LoginScreen itself: it renders no
    // tenant data and only POSTs the public /api/auth/reset-password endpoint (which requireUser
    // already exempts server-side). window.location (not router state) is correct here — this
    // component sits ABOVE the router, and the page's only exit is a full page load (see
    // ResetPassword), so the path can't go stale mid-session. ResetPassword consumes no auth
    // context, so this carve-out can remain a plain pass-through.
    //
    // Use the router's own matching semantics for exactly one non-empty, non-nested token segment.
    // A malformed link (a token truncated to `/reset-password/`, or a trailing
    // `/reset-password/<token>/extra`) matches NO route. Carving that out would drop a signed-out
    // visitor onto the generic not-found route; failing the match here instead keeps the login wall
    // as the fallback (a styled screen with a way to authenticate), which is the safer degrade.
    if (publicEntry === "password-reset") return <>{children}</>;
    // Invite onboarding must render before a session exists. Password mode offers the token-scoped
    // credential flow; SSO mode initiates the configured provider with this invite URL as its
    // callback, then reviews and explicitly accepts after the authenticated reload. Neither path
    // exposes tenant data before the invitation is consumed.
    if (publicEntry === "invitation") {
      // Invite signup consumes the token before the new session exists. Give the pre-session route
      // a real refreshAuth so it can verify the freshly-created session and destination before a
      // fresh authenticated boot re-attaches tenant persistence. No tenant data is exposed: user
      // remains null until /me succeeds.
      return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
    }
    return (
      <Suspense fallback={<AuthLoading message={m.auth_loading_sign_in()} />}>
        {/* Reload on success: a clean boot verifies the new cookie, then hydrates from the server
            and attaches persistence. State-juggling here would re-implement that boot sequence. */}
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
  if (status.mfaRequired && status.authMode === "password") {
    return (
      <Suspense fallback={<AuthLoading message={m.auth_loading_sign_in()} />}>
        <MfaEnrollmentScreen
          blockedEntry={publicAuthEntryForPath(window.location.pathname)}
          onEnrolled={confirmMfaEnrollment}
          onSignOut={() => void signOut()}
        />
      </Suspense>
    );
  }
  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
      {status.authMode !== "off" && <AuthenticatedExternalSignInFailure />}
      {/* Step-up re-auth host (DEFECT B): renders the "Confirm it's you" dialog when a
          security-sensitive action hits a SESSION_NOT_FRESH 403. Auth-on only — 'off' never 403s
          on freshness, so it needs no step-up UI (and this keeps the off/demo path unchanged). */}
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
