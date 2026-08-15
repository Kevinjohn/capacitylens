import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { isServerConfigured } from "../data/apiConfig";
import {
  accountClient,
  bindStoredAccountCommandsToIdentity,
  clearStoredAccountCommands,
} from "../account/accountClient";
import { publicAuthEntryForPath } from "./authEntryRoute";
import { hasDuplicateIdentity } from "../lib/arrayIdentity";
import { useStore } from "../store/useStore";
import {
  AuthContext,
  isSupportedSocialProviderId,
  type AuthMode,
  type AuthProviderInfo,
  type AuthUser,
} from "./authContext";
import { validateAuthUser } from "./validateAuthUser";
import { reauthPending, resolveReauth, subscribeReauth } from "./reauthCoordinator";
import {
  clearExternalSignInError,
  externalSignInErrorCode,
  externalSignInErrorMessage,
  hasExternalSignInError,
} from "./externalSignInError";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  cacheAuthSnapshot,
  OFFLINE_WRITE_BOUNDARY_STORAGE_KEY,
  readCachedAuthSnapshot,
  revalidateOfflineShell,
  setOfflineReadState,
} from "../data/offlineCache";
import { isTransportFailure } from "../data/requestTimeout";
import { hasUnsavedPersistenceWrites } from "../data/persist";
import { signOutAndReload } from "./signOut";
import { APP_NAME } from "@capacitylens/shared/brand";
import { readApiError } from "../lib/readApiError";
import { markCompanyPickerForNextReload } from "../lib/companyPickerEntry";

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
// Lazy so Better Auth's client (pulled in by ReauthDialog) never enters the main bundle — the same
// discipline as LoginScreen. The step-up dialog only exists in an auth-on session that hits a
// SESSION_NOT_FRESH 403 (DEFECT B).
const ReauthDialog = lazy(() => import("./ReauthDialog").then((m) => ({ default: m.ReauthDialog })));

// A stable (never-reallocated) empty providers array — used as the authContextValue memo's fallback
// for statuses that never actually read it (checking/error), so those renders can't be mistaken by
// the memo's dependency check for a "providers changed" render (a fresh `[]` literal would).
const EMPTY_PROVIDERS: AuthProviderInfo[] = [];

type Status =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | {
      kind: "pass";
      authMode: AuthMode;
      user: AuthUser | null;
      canCreateAccount: boolean;
      multiAccount: boolean;
      mfaRequired: boolean;
      providers: AuthProviderInfo[];
      reauthMethod: "password" | "provider";
      reauthProviderId: string | null;
    }
  | {
      kind: "login";
      authMode: "password" | "sso";
      needsSetup: boolean;
      providers: AuthProviderInfo[];
      /** True when the 401 body itself was untrustworthy (non-JSON, an HTML proxy page, or a
       *  junk `authMode` value) — as opposed to a well-formed body that simply predates a field
       *  (an older server omitting `providers`) or explicitly selects password/SSO. The login
       *  wall uses this to show a non-terminal "configuration couldn't be loaded" notice above
       *  the password fallback, so an SSO-only instance behind a broken proxy doesn't strand the
       *  user on a bare, unexplained password form. See DECISIONS.md's 401 sign-in-wall entry. */
      degraded: boolean;
      /** Captured synchronously at the 401 boundary, before replacing the app detaches persistence. */
      hadUnsavedChanges: boolean;
    };

// A 'pass' Status that fails OPEN on the single-company-per-instance fields (see authContext.ts):
// used for every branch below that can't read a trustworthy canCreateAccount/multiAccount off the
// wire (an off-spec body, a non-401 non-ok response, or a network failure) — the server 403 remains
// the real enforcer, so "unknown" must never hide a legitimate "New company" affordance.
function passOpen(authMode: AuthMode, user: AuthUser | null): Status {
  return {
    kind: "pass",
    authMode,
    user,
    canCreateAccount: true,
    multiAccount: true,
    mfaRequired: false,
    providers: [],
    reauthMethod: "password",
    reauthProviderId: null,
  };
}

// Narrowing guards for the UNTRUSTED /api/auth/me response body (see fetchAuthStatus). The server
// is external input — we validate its shape rather than trusting an `as` cast.
function isAuthMode(v: unknown): v is AuthMode {
  return v === "off" || v === "password" || v === "sso";
}
function isAuthProvider(v: unknown): v is AuthProviderInfo {
  if (typeof v !== "object" || v === null) return false;
  const provider = v as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    provider.id.length > 0 &&
    typeof provider.label === "string" &&
    provider.label.length > 0 &&
    (provider.kind === "oidc" || (provider.kind === "social" && isSupportedSocialProviderId(provider.id))) &&
    typeof provider.experimental === "boolean"
  );
}

function providersFrom(v: unknown): AuthProviderInfo[] {
  if (!Array.isArray(v)) return [];
  const providers: AuthProviderInfo[] = [];
  for (const candidate of v) {
    if (isAuthProvider(candidate)) {
      providers.push(candidate);
      continue;
    }
    const record = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
    const candidateId = record?.id;
    const summary = record
      ? {
          id: typeof candidateId === "string" ? candidateId.slice(0, 128) : "[invalid]",
          kind: typeof record.kind === "string" ? record.kind.slice(0, 32) : typeof record.kind,
        }
      : { id: "[invalid]", kind: typeof candidate };
    console.warn("AuthProvider: dropped an unsupported or malformed /api/auth/me provider", summary);
  }
  if (hasDuplicateIdentity(providers, (provider) => `${provider.kind}:${provider.id}`)) {
    console.warn("AuthProvider: /api/auth/me returned duplicate provider identities; ignoring the provider list");
    return [];
  }
  return providers;
}
/** Reads a boolean field off the untrusted body, using the supplied compatibility fallback when it's
 *  absent or not a boolean — covers an older server that predates these fields as well as a
 *  malformed response. See `AuthContextValue.canCreateAccount` (authContext.ts) for why "unknown"
 *  means "allowed": the server 403 is the authoritative enforcer, this only gates a UI affordance. */
function boolFieldOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Ask the server who we are. Total (never throws): a 401 maps to login, a valid 200 to pass,
 *  and transport/status/shape failures map to an explicit error. Boot must never reinterpret a
 *  broken authentication service as auth-off; mid-session callers may retain their last snapshot.
 *  Module-scope so the component's effects only subscribe to its result. */
async function fetchAuthStatus(acceptEffects: () => boolean): Promise<Status | null> {
  try {
    const res = await accountClient.me();
    if (res.status === 401) {
      // POLICY (see DECISIONS.md — the 401 sign-in-wall contract): a 401 ALWAYS lands the signed-out
      // user on the sign-in wall. It can never be worse to let a signed-out user attempt sign-in, so
      // this branch NEVER renders the terminal 'invalid configuration' error screen (which stranded
      // the user with no way in). Parse the body LENIENTLY: a version-skewed OLDER server that omits
      // the providers array, or a proxy returning an empty / HTML / non-JSON 401 body, must still
      // reach a usable login form. A valid authMode is used as-is (providers default to []); a
      // malformed/empty/non-JSON body falls back to the password login form.
      const body: unknown = await res.json().catch(() => null);
      const loginBody =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as {
              authMode?: unknown;
              needsSetup?: unknown;
              providers?: unknown;
            })
          : null;
      // Only an explicit 'sso' selects the SSO form; anything else (missing, junk, or 'password')
      // falls back to the password sign-in form — the safe default that always offers a way in.
      const rawAuthMode = loginBody?.authMode;
      const authMode: "password" | "sso" = rawAuthMode === "sso" ? "sso" : "password";
      // DEGRADED (distinct from the ordinary "old server omits providers" compatibility case
      // above): the body couldn't be trusted at ALL — non-JSON/HTML/empty (loginBody null), or a
      // junk authMode value that isn't even a recognizable 'password'/'sso' (rather than simply
      // absent). Both still fall back to the password form (never strand the user), but here the
      // fallback is a guess, not a real signal — the login wall surfaces a non-terminal notice so
      // an SSO-only instance behind a broken proxy doesn't look like a silently misconfigured
      // password-only one. An absent authMode (a well-formed but older body) is NOT degraded.
      const degraded =
        loginBody === null || (rawAuthMode !== undefined && rawAuthMode !== "password" && rawAuthMode !== "sso");
      if (acceptEffects()) setOfflineReadState("identity", false);
      return {
        kind: "login",
        authMode,
        degraded,
        hadUnsavedChanges: hasUnsavedPersistenceWrites(),
        providers: providersFrom(loginBody?.providers), // [] when absent/malformed — never a hard error
        // FAIL-CLOSED: only a literal `true` (a server that computed "password mode + empty user
        // table") shows the owner-setup form — absent (an older server) or junk means the
        // ordinary sign-in, never a create-account form on a populated instance.
        needsSetup: loginBody?.needsSetup === true,
      };
    }
    if (res.ok) {
      // UNTRUSTED external input: a proxy HTML page, a truncated/old response, or a server bug could
      // yield a bogus authMode or a user with no id, which would otherwise flow straight into
      // AuthContext and the Settings gate. Validate before trusting; anything off-spec renders the
      // explicit authentication error boundary rather than opening the app.
      const body: unknown = await res.json();
      const rawMode = (body as { authMode?: unknown } | null)?.authMode;
      if (!isAuthMode(rawMode)) {
        console.warn("AuthProvider: /api/auth/me returned an unexpected authMode; nothing trustworthy learned", body);
        return { kind: "error", message: m.auth_service_invalid_response() };
      }
      const rawUser = (body as { user?: unknown } | null)?.user;
      // Every authenticated server session has a non-empty email. Password reauthentication uses
      // it directly, and SSO invitation/identity policy also treats it as part of SessionUser.
      // Auth-off retains the deliberately smaller demo-user compatibility shape.
      const user = validateAuthUser(rawUser, rawMode !== "off");
      if (rawMode !== "off" && !user) {
        console.warn("AuthProvider: /api/auth/me returned auth-on without a valid user", body);
        return { kind: "error", message: m.auth_service_invalid_response() };
      }
      // Company-creation capability: the server computes both fields (canCreateAccount mirrors the
      // POST /api/orgs gate — the instance cap AND the caller's owner/admin standing), fail-open to
      // `true` when absent (an older server, or a response shape we don't recognise) — see
      // boolFieldOr and AuthContextValue.canCreateAccount.
      const canCreateAccount = boolFieldOr((body as { canCreateAccount?: unknown } | null)?.canCreateAccount, true);
      const multiAccount = boolFieldOr((body as { multiAccount?: unknown } | null)?.multiAccount, true);
      const mfaRequired =
        rawMode === "password" && boolFieldOr((body as { mfaRequired?: unknown } | null)?.mfaRequired, false);
      const next: Status = {
        kind: "pass",
        authMode: rawMode,
        user,
        canCreateAccount,
        multiAccount,
        mfaRequired,
        // The authenticated /me also advertises the configured SSO providers (server app.ts). We
        // carry them so the SESSION_NOT_FRESH step-up dialog can offer the SAME provider re-auth
        // route the login screen uses (DEFECT B). Off-spec entries are dropped (providersFrom).
        providers: providersFrom((body as { providers?: unknown } | null)?.providers),
        reauthMethod:
          (body as { reauthMethod?: unknown } | null)?.reauthMethod === "provider" || rawMode === "sso"
            ? "provider"
            : "password",
        reauthProviderId:
          typeof (body as { reauthProviderId?: unknown } | null)?.reauthProviderId === "string"
            ? ((body as { reauthProviderId: string }).reauthProviderId ?? null)
            : null,
      };
      // A live identity check does not prove the currently rendered tenant slice is live. Preserve
      // its offline/read-only marker until ServerSyncAdapter successfully reloads that slice; only
      // a boot/picker with no active slice can be marked online from identity state alone.
      if (acceptEffects() && useStore.getState().activeAccountId === null) setOfflineReadState("identity", false);
      if (next.user && acceptEffects()) {
        void cacheAuthSnapshot({
          authMode: next.authMode,
          user: next.user,
          canCreateAccount: next.canCreateAccount,
          multiAccount: next.multiAccount,
        }).catch((error) => console.warn("AuthProvider: the offline identity snapshot could not be updated", error));
      }
      return next;
    }
    if (res.status === 503) {
      return {
        kind: "error",
        message: (await readApiError(res)) ?? m.auth_check_failed({ status: res.status }),
      };
    }
    return {
      kind: "error",
      message: m.auth_check_failed({ status: res.status }),
    };
  } catch (err) {
    // A previously opted-in device may continue with its last VERIFIED identity, but only in the
    // global read-only state. Only a transport failure qualifies: a reachable server returning
    // malformed JSON must surface as an auth error, never be reinterpreted as "offline".
    const transportFailure = isTransportFailure(err);
    if (transportFailure) {
      try {
        const cached = await readCachedAuthSnapshot({ acceptEffects });
        if (cached) {
          if (acceptEffects()) setOfflineReadState("identity", true, cached.savedAt);
          return {
            kind: "pass",
            authMode: cached.value.authMode,
            user: cached.value.user,
            canCreateAccount: false,
            multiAccount: cached.value.multiAccount,
            mfaRequired: false,
            // Offline: no live provider list and no way to reach an IdP anyway — the step-up dialog
            // is unreachable here regardless (a security 403 needs the server), so [] is correct.
            providers: [],
            reauthMethod: "password",
            reauthProviderId: null,
          };
        }
      } catch (cacheError) {
        console.warn("AuthProvider: the offline identity snapshot could not be read", cacheError);
      }
    }
    console.warn("AuthProvider: /api/auth/me check failed", err);
    return {
      kind: "error",
      message: transportFailure ? m.auth_service_unreachable() : m.auth_service_invalid_response(),
    };
  }
}

/** Bridges the module-level re-auth coordinator (reauthCoordinator.ts) into React: subscribes to the
 *  pending flag via useSyncExternalStore and, while a SESSION_NOT_FRESH step-up is pending, renders
 *  the lazy ReauthDialog. Mounted INSIDE the authenticated provider (and only in auth-on, never
 *  'off') so it always has the live session's authMode/user/providers — auth-off never receives a
 *  freshness 403, so it needs no step-up UI. */
function ReauthMount({
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

function AuthLoading({ message, overlay = false }: { message: string; overlay?: boolean }) {
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
function AuthenticatedExternalSignInFailure() {
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
