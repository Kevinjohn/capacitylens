import { apiFetchReauth } from "@/auth/apiFetchReauth";
import { apiFetch } from "@/data/requestTimeout";
import { buildExternalSignInErrorUrl } from "@/auth/externalSignInError";
import { apiRouteUrl } from "@/api/queryClient";
import type { ReauthAction } from "@/auth/reauthCoordinator";

/** Reads the current identity-provider link state. */
export function readIdentityProvider(providerId: "google"): Promise<Response> {
  const query = `?providerId=${providerId}`;
  return apiFetch(`${apiRouteUrl("api.google.identity", {})}${query}`, { credentials: "include" });
}

/** Starts a re-authenticated identity-provider link flow. */
export function linkIdentityProvider(
  callbackURL: string,
  providerId: "google",
  errorCallbackURL = buildExternalSignInErrorUrl(callbackURL),
): Promise<Response> {
  return apiFetchReauth(
    apiRouteUrl("api.google.link", {}),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, callbackURL, errorCallbackURL }),
    },
    // The server rejects stale sessions before starting either provider flow or setting cookies.
    { action: "connect-provider" satisfies ReauthAction, replayAfterFreshnessRefusal: true },
  );
}
