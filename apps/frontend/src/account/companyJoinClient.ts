import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";
import { apiRouteUrl } from "@/api/queryClient";

function post(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  return apiFetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
}

/** Provides request methods for company-join metadata and status. */
export const companyJoinClient = {
  metadata: (accountId: string) =>
    apiFetch(apiRouteUrl("api.joining.metadata", { params: { accountId } }), { credentials: "include" }),
  requestJoinEmailVerification: (accountId: string) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/join/verify-email`, {}),
  confirmJoinEmailVerification: (token: string) => post("/api/company-join/verify-email", { token }),
  completeExisting: (accountId: string) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/join/complete-existing`, {}),
};
