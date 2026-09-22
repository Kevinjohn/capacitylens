import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";

/** Company-scoped onboarding dismissal requests. */
export const gettingStartedClient = {
  read(accountId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(accountId)}/getting-started`, {
      credentials: "include",
      ...(signal ? { signal } : {}),
    });
  },

  dismiss(accountId: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(accountId)}/getting-started`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed: true }),
    });
  },
};
