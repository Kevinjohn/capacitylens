import { accountClient } from "../account/accountClient";
import { cacheAuthSnapshot, readCachedAuthSnapshot, setOfflineReadState } from "../data/offlineCache";
import { hasUnsavedPersistenceWrites } from "../data/persist";
import { isTransportFailure } from "../data/requestTimeout";
import { readApiError } from "../lib/readApiError";
import { useStore } from "../store/useStore";
import { m } from "@/i18n";
import { isAuthMode, parseAuthProviders, resolveBooleanField, type AuthStatusResult } from "./authStatus";
import { parseAuthUser } from "./validateAuthUser";

interface AuthResponseFields {
  authMode: unknown;
  canCreateAccount: unknown;
  mfaRequired: unknown;
  multiAccount: unknown;
  needsSetup: unknown;
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
    mfaRequired: readField(value, "mfaRequired"),
    multiAccount: readField(value, "multiAccount"),
    needsSetup: readField(value, "needsSetup"),
    providers: readField(value, "providers"),
    reauthMethod: readField(value, "reauthMethod"),
    reauthProviderId: readField(value, "reauthProviderId"),
    user: readField(value, "user"),
  };
}

function parseLoginResult(body: unknown, acceptEffects: () => boolean): AuthStatusResult {
  const fields = parseAuthResponseFields(body);
  const rawAuthMode = fields?.authMode;
  const authMode = rawAuthMode === "sso" ? "sso" : "password";
  const degraded =
    fields === null || (rawAuthMode !== undefined && rawAuthMode !== "password" && rawAuthMode !== "sso");
  if (acceptEffects()) setOfflineReadState("identity", false);
  return {
    kind: "login",
    authMode,
    degraded,
    hadUnsavedChanges: hasUnsavedPersistenceWrites(),
    providers: parseAuthProviders(fields?.providers),
    needsSetup: fields?.needsSetup === true,
  };
}

function invalidResponse(body: unknown): AuthStatusResult {
  console.warn("AuthProvider: /api/auth/me returned an unexpected authMode; nothing trustworthy learned", body);
  return { kind: "error", message: m.auth_service_invalid_response() };
}

function updateLiveIdentityState(next: Extract<AuthStatusResult, { kind: "pass" }>, acceptEffects: () => boolean) {
  if (acceptEffects() && useStore.getState().activeAccountId === null) setOfflineReadState("identity", false);
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
  if (!fields || !isAuthMode(fields.authMode)) return invalidResponse(body);
  const authMode = fields.authMode;
  const user = parseAuthUser({ value: fields.user, requireEmail: authMode !== "off" });
  if (authMode !== "off" && !user) {
    console.warn("AuthProvider: /api/auth/me returned auth-on without a valid user", body);
    return { kind: "error", message: m.auth_service_invalid_response() };
  }
  const next: Extract<AuthStatusResult, { kind: "pass" }> = {
    kind: "pass",
    authMode,
    user,
    canCreateAccount: resolveBooleanField(fields.canCreateAccount, true),
    multiAccount: resolveBooleanField(fields.multiAccount, true),
    mfaRequired: authMode === "password" && resolveBooleanField(fields.mfaRequired, false),
    providers: parseAuthProviders(fields.providers),
    reauthMethod: fields.reauthMethod === "provider" || authMode === "sso" ? "provider" : "password",
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
    if (acceptEffects()) setOfflineReadState("identity", true, cached.savedAt);
    return {
      kind: "pass",
      authMode: cached.value.authMode,
      user: cached.value.user,
      canCreateAccount: false,
      multiAccount: cached.value.multiAccount,
      mfaRequired: false,
      providers: [],
      reauthMethod: "password",
      reauthProviderId: null,
    };
  } catch (cacheError) {
    console.warn("AuthProvider: the offline identity snapshot could not be read", cacheError);
    return null;
  }
}

/** Ask the server who we are. This function is total and never throws. */
export async function fetchAuthStatus(acceptEffects: () => boolean): Promise<AuthStatusResult | null> {
  try {
    return await readAuthResponse(await accountClient.me(), acceptEffects);
  } catch (error) {
    const cached = await readOfflineIdentity(error, acceptEffects);
    if (cached) return cached;
    console.warn("AuthProvider: /api/auth/me check failed", error);
    return {
      kind: "error",
      message: isTransportFailure(error) ? m.auth_service_unreachable() : m.auth_service_invalid_response(),
    };
  }
}
