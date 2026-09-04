import { accountClient } from "../account/accountClient";
import { useStore } from "../store/useStore";
import { validateAuthUser } from "./validateAuthUser";
import { m } from "@/i18n";
import { cacheAuthSnapshot, readCachedAuthSnapshot, setOfflineReadState } from "../data/offlineCache";
import { isTransportFailure } from "../data/requestTimeout";
import { hasUnsavedPersistenceWrites } from "../data/persist";
import { readApiError } from "../lib/readApiError";
import { boolFieldOr, isAuthMode, providersFrom, type Status } from "./authStatus";

/** Ask the server who we are. Total (never throws): a 401 maps to login, a valid 200 to pass,
 *  and transport/status/shape failures map to an explicit error. Boot must never reinterpret a
 *  broken authentication service as auth-off; mid-session callers may retain their last snapshot.
 *  Module-scope so the component's effects only subscribe to its result. */
export async function fetchAuthStatus(acceptEffects: () => boolean): Promise<Status | null> {
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
