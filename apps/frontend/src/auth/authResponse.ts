import { allowsProviderSignIn } from "@capacitylens/shared/account/types";
import { hasUnsavedPersistenceWrites } from "@/data/persist";
import { readApiError } from "@/lib/readApiError";
import { m } from "@/i18n";
import { isAuthMode, parseAuthProviders, resolveBooleanField } from "./authStatus";
import type { AuthStatusResult } from "./authStatus";
import { parseAuthUser } from "./validateAuthUser";

interface AuthResponseFields {
  authMode: unknown;
  canCreateAccount: unknown;
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
    needsSetup: readField(value, "needsSetup"),
    passwordResetEmail: readField(value, "passwordResetEmail"),
    providers: readField(value, "providers"),
    reauthMethod: readField(value, "reauthMethod"),
    reauthProviderId: readField(value, "reauthProviderId"),
    user: readField(value, "user"),
  };
}

function parseLoginResult(body: unknown): AuthStatusResult {
  const fields = parseAuthResponseFields(body);
  const rawAuthMode = fields?.authMode;
  const authMode = isAuthMode(rawAuthMode) && rawAuthMode !== "off" ? rawAuthMode : "password-only";
  const degraded =
    fields === null || (rawAuthMode !== undefined && (!isAuthMode(rawAuthMode) || rawAuthMode === "off"));
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

/** Reject identity responses whose mode cannot be trusted. */
export function invalidResponse(): AuthStatusResult {
  console.warn("AuthProvider: /api/auth/me returned an unexpected authMode; nothing trustworthy learned");
  return { kind: "error", message: m.auth_service_invalid_response() };
}

function parsePassResult(body: unknown): AuthStatusResult {
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
    providers: authMode === "password-only" ? [] : parseAuthProviders(fields.providers),
    reauthMethod: fields.reauthMethod === "provider" || authMode === "sso-only" ? "provider" : "password",
    reauthProviderId: typeof fields.reauthProviderId === "string" ? fields.reauthProviderId : null,
  };
  return next;
}

/** Parse the native identity response. */
export async function readAuthResponse(res: Response): Promise<AuthStatusResult> {
  if (res.status === 401) {
    // A 401 always offers sign-in. An unreadable body degrades to the password form.
    const body: unknown = await res.json().catch(() => null);
    return parseLoginResult(body);
  }
  if (res.ok) return parsePassResult(await res.json());
  if (res.status === 503) {
    return { kind: "error", message: (await readApiError(res)) ?? m.auth_check_failed({ status: res.status }) };
  }
  return { kind: "error", message: m.auth_check_failed({ status: res.status }) };
}
