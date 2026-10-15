import { allowsProviderSignIn } from "@capacitylens/shared/account/types";
import { accountClient } from "@/account/accountClient";
import { cacheAuthSnapshot, readCachedAuthSnapshot, setOfflineReadState } from "@/data/offlineCache";
import { hasUnsavedPersistenceWrites } from "@/data/persist";
import { isTransportFailure } from "@/data/requestTimeout";
import { readApiError } from "@/lib/readApiError";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";
import { isAuthMode, parseAuthProviders, resolveBooleanField } from "./authStatus";
import type { AuthStatusResult } from "./authStatus";
import { parseAuthUser } from "./validateAuthUser";
import { adoptMasqueradeStatus } from "./accountTransition";
import { masqueradeApi } from "./masqueradeApi";

interface AuthResponseFields {
  authMode: unknown;
  canCreateAccount: unknown;
  multiAccount: unknown;
  needsSetup: unknown;
  passwordResetEmail: unknown;
  providers: unknown;
  reauthMethod: unknown;
  reauthProviderId: unknown;
  user: unknown;
}

function readField(value: object, key: keyof AuthResponseFields): unknown {
  return Reflect.get(value, key);
}

function parseAuthResponseFields(value: unknown): AuthResponseFields | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return {
    authMode: readField(value, "authMode"),
    canCreateAccount: readField(value, "canCreateAccount"),
    multiAccount: readField(value, "multiAccount"),
    needsSetup: readField(value, "needsSetup"),
    passwordResetEmail: readField(value, "passwordResetEmail"),
    providers: readField(value, "providers"),
    reauthMethod: readField(value, "reauthMethod"),
    reauthProviderId: readField(value, "reauthProviderId"),
    user: readField(value, "user"),
  };
}

function parseLoginResult(body: unknown, acceptEffects: () => boolean): AuthStatusResult {
  const fields = parseAuthResponseFields(body);
  const rawAuthMode = fields?.authMode;
  const authMode = isAuthMode(rawAuthMode) && rawAuthMode !== "off" ? rawAuthMode : "password-only";
  const degraded =
    fields === null || (rawAuthMode !== undefined && (!isAuthMode(rawAuthMode) || rawAuthMode === "off"));
  if (acceptEffects()) setOfflineReadState({ owner: "identity", readOnly: false });
  return {
    kind: "login",
    authMode,
    degraded,
    hadUnsavedChanges: hasUnsavedPersistenceWrites(),
    providers: allowsProviderSignIn(authMode) ? parseAuthProviders(fields?.providers) : [],
    needsSetup: fields?.needsSetup === true,
    passwordResetEmail: fields?.passwordResetEmail === true,
  };
}

function invalidResponse(): AuthStatusResult {
  console.warn("AuthProvider: /api/auth/me returned an unexpected authMode; nothing trustworthy learned");
  return { kind: "error", message: m.auth_service_invalid_response() };
}

function updateLiveIdentityState(next: Extract<AuthStatusResult, { kind: "pass" }>, acceptEffects: () => boolean) {
  if (acceptEffects() && useStore.getState().activeAccountId === null)
    setOfflineReadState({ owner: "identity", readOnly: false });
  if (!next.user || !acceptEffects()) return;
  void cacheAuthSnapshot({
    authMode: next.authMode,
    user: next.user,
    canCreateAccount: next.canCreateAccount,
    multiAccount: next.multiAccount,
  }).catch((error) => console.warn("AuthProvider: the offline identity snapshot could not be updated", error));
}

function parsePassResult(body: unknown, acceptEffects: () => boolean): AuthStatusResult {
  const fields = parseAuthResponseFields(body);
  if (!fields || !isAuthMode(fields.authMode)) return invalidResponse();
  const authMode = fields.authMode;
  const user = parseAuthUser({ value: fields.user, requireEmail: authMode !== "off" });
  if (authMode !== "off" && !user) {
    console.warn("AuthProvider: /api/auth/me returned auth-on without a valid user");
    return { kind: "error", message: m.auth_service_invalid_response() };
  }
  const next: Extract<AuthStatusResult, { kind: "pass" }> = {
    kind: "pass",
    identitySource: authMode === "off" ? "open" : "live",
    authMode,
    user,
    canCreateAccount: resolveBooleanField({ value: fields.canCreateAccount, fallback: true }),
    multiAccount: resolveBooleanField({ value: fields.multiAccount, fallback: true }),
    providers: authMode === "password-only" ? [] : parseAuthProviders(fields.providers),
    reauthMethod: fields.reauthMethod === "provider" || authMode === "sso-only" ? "provider" : "password",
    reauthProviderId: typeof fields.reauthProviderId === "string" ? fields.reauthProviderId : null,
  };
  updateLiveIdentityState(next, acceptEffects);
  return next;
}

async function readAuthResponse(res: Response, acceptEffects: () => boolean): Promise<AuthStatusResult> {
  if (res.status === 401) {
    // A 401 always offers sign-in. An unreadable body degrades to the password form.
    const body: unknown = await res.json().catch(() => null);
    return parseLoginResult(body, acceptEffects);
  }
  if (res.ok) return parsePassResult(await res.json(), acceptEffects);
  if (res.status === 503) {
    return { kind: "error", message: (await readApiError(res)) ?? m.auth_check_failed({ status: res.status }) };
  }
  return { kind: "error", message: m.auth_check_failed({ status: res.status }) };
}

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

/** Refill the encrypted identity snapshot only after a server-confirmed return to the real principal. */
export async function refreshOfflineIdentityAfterMasquerade(): Promise<boolean> {
  try {
    const status = await masqueradeApi.status();
    if (status.active) return false;
    const result = await readAuthResponse(await accountClient.me(), () => true);
    return result.kind === "pass" && result.identitySource === "live";
  } catch (error) {
    console.warn("AuthProvider: the real identity could not be refreshed after masquerade", error);
    return false;
  }
}
