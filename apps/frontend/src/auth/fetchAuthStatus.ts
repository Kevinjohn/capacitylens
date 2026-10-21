import { accountClient } from "@/account/accountClient";
import { isTransportFailure } from "@/data/requestTimeout";
import { m } from "@/i18n";
import { isAuthMode } from "./authStatus";
import type { AuthStatusResult } from "./authStatus";
import { parseAuthUser } from "./validateAuthUser";
import { adoptMasqueradeStatus } from "./accountTransition";
import { masqueradeApi } from "./masqueradeApi";
import { invalidResponse, readAuthResponse } from "./authResponse";

async function resolveIdentityWhileMasqueradeStatusIsUnknown(statusError: unknown): Promise<AuthStatusResult> {
  if (!isTransportFailure(statusError)) return authServiceError(statusError);
  try {
    const response = await accountClient.me();
    if (response.status === 401) return readAuthResponse(response);
    if (!response.ok) return readAuthResponse(response);
    // /me does not prove that masquerade is inactive. Keep the auth boundary closed even if
    // the endpoint succeeds while the status endpoint is unreachable.
    return authServiceError(statusError);
  } catch (error) {
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
      providers: [],
      reauthMethod: "password",
      reauthProviderId: null,
    };
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
    // /me can resolve only a 401 here; a successful response does not prove inactivity.
    console.warn("AuthProvider: masquerade status could not be checked", error);
    return resolveIdentityWhileMasqueradeStatusIsUnknown(error);
  }
  if (masquerade.active) return readActiveMasqueradeAuthStatus(masquerade, acceptEffects);
  try {
    return await readAuthResponse(await accountClient.me());
  } catch (error) {
    console.warn("AuthProvider: /api/auth/me check failed", error);
    return authServiceError(error);
  }
}
