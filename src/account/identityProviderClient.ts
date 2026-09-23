import { apiFetchReauth } from "../auth/apiFetchReauth";
import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";
import type { ReauthAction } from "../auth/reauthCoordinator";

export function getIdentityProvider(providerId?: string): Promise<Response> {
  const query = providerId ? `?providerId=${encodeURIComponent(providerId)}` : "";
  return apiFetch(`${API_BASE}/api/identity/provider${query}`, { credentials: "include" });
}

export function linkIdentityProvider(callbackURL: string, providerId?: string): Promise<Response> {
  return apiFetchReauth(
    `${API_BASE}/api/identity/link-provider`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callbackURL, errorCallbackURL: callbackURL, ...(providerId ? { providerId } : {}) }),
    },
    { action: "connect-provider" satisfies ReauthAction },
  );
}
