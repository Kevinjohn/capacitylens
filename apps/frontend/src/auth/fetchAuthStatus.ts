import { accountClient } from "@/account/accountClient";
import { readCachedAuthSnapshot, setOfflineReadState } from "@/data/offlineCache";
import { isTransportFailure } from "@/data/requestTimeout";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";
import { isAuthMode } from "./authStatus";
import type { AuthStatusResult } from "./authStatus";
import { parseAuthUser } from "./validateAuthUser";
import { adoptMasqueradeStatus } from "./accountTransition";
import { masqueradeApi } from "./masqueradeApi";
import { invalidResponse, readAuthResponse } from "./authResponse";

async function readOfflineIdentity(error: unknown, acceptEffects: () => boolean): Promise<AuthStatusResult | null> {
  if (!isTransportFailure(error)) return null;
  try {
    const cached = await readCachedAuthSnapshot({ acceptEffects });
    if (!cached) return null;
    if (acceptEffects()) setOfflineReadState({ owner: "identity", readOnly: true, lastUpdated: cached.savedAt });
    return {
      kind: "pass",
      identitySource: "offline",
      authMode: cached.value.authMode,
      user: cached.value.user,
      canCreateAccount: false,
      multiAccount: cached.value.multiAccount,
      providers: [],
      reauthMethod: "password",
      reauthProviderId: null,
    };
  } catch (cacheError) {
    // An unreadable optional identity cache must not hide the original live-auth failure; warn and let normal recovery continue.
    console.warn("AuthProvider: the offline identity snapshot could not be read", cacheError);
    return null;
  }
}

async function resolveIdentityWhileMasqueradeStatusIsUnknown(
  statusError: unknown,
  acceptEffects: () => boolean,
): Promise<AuthStatusResult> {
  if (!isTransportFailure(statusError)) return authServiceError(statusError);
  try {
    const response = await accountClient.me();
    if (response.status === 401) return readAuthResponse(response, acceptEffects);
    if (!response.ok) return readAuthResponse(response, acceptEffects);
    // /me does not prove that masquerade is inactive. Keep the auth boundary closed even if
    // the endpoint succeeds while the status endpoint is unreachable.
    return authServiceError(statusError);
  } catch (error) {
    const cached = await readOfflineIdentity(error, acceptEffects);
    if (cached) return cached;
    console.warn("AuthProvider: /api/auth/me also failed while masquerade status was unknown", error);
    return authServiceError(error);
  }
}

/** Ask the server who we are. This function is total and never throws. */
async function readActiveMasqueradeAuthStatus(
  masquerade: Extract<Awaited<ReturnType<typeof masqueradeApi.status>>, { active: true }>,
  acceptEffects: () => boolean,
): Promise<AuthStatusResult | null> {
  try {
    if (!(await adoptMasqueradeStatus(masquerade, acceptEffects))) return null;
    const user = parseAuthUser({ value: masquerade.principal, requireEmail: true });
    if (!user || !isAuthMode(masquerade.authMode)) return invalidResponse();
    const next: Extract<AuthStatusResult, { kind: "pass" }> = {
      kind: "pass",
      identitySource: "live",
      authMode: masquerade.authMode,
      user,
      canCreateAccount: false,
      multiAccount: false,
      providers: [],
      reauthMethod: "password",
      reauthProviderId: null,
    };
    if (acceptEffects() && useStore.getState().activeAccountId === null)
      setOfflineReadState({ owner: "identity", readOnly: false });
    return next;
  } catch (error) {
    console.warn("AuthProvider: active masquerade could not be adopted", error);
    return {
      kind: "error",
      message: isTransportFailure(error) ? m.auth_service_unreachable() : m.auth_service_invalid_response(),
    };
  }
}

function authServiceError(error: unknown): AuthStatusResult {
  return {
    kind: "error",
    message: isTransportFailure(error) ? m.auth_service_unreachable() : m.auth_service_invalid_response(),
  };
}

export async function fetchAuthStatus(acceptEffects: () => boolean): Promise<AuthStatusResult | null> {
  let masquerade: Awaited<ReturnType<typeof masqueradeApi.status>>;
  try {
    masquerade = await masqueradeApi.status();
  } catch (error) {
    // A network outage may still allow a validated offline identity when no uncertain projection
    // is marked. /me can resolve only a 401 here; a successful response does not prove inactivity.
    console.warn("AuthProvider: masquerade status could not be checked", error);
    return resolveIdentityWhileMasqueradeStatusIsUnknown(error, acceptEffects);
  }
  if (masquerade.active) return readActiveMasqueradeAuthStatus(masquerade, acceptEffects);
  try {
    return await readAuthResponse(await accountClient.me(), acceptEffects);
  } catch (error) {
    // A definite inactive status permits the existing offline identity fallback after /me fails.
    const cached = await readOfflineIdentity(error, acceptEffects);
    if (cached) return cached;
    console.warn("AuthProvider: /api/auth/me check failed", error);
    return authServiceError(error);
  }
}

export { refreshOfflineIdentityAfterMasquerade } from "./authResponse";
