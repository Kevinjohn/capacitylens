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
  status: () => apiFetch(apiRouteUrl("api.joining.status", {}), { credentials: "include" }),
  startProvider: (
    input: { accountId: string; email: string; invitationToken: string | null; providerId: "google" },
    signal?: AbortSignal,
  ) =>
    post(
      apiRouteUrl("api.google.join-start", { params: { accountId: input.accountId } }).replace(API_BASE, ""),
      {
        purpose: input.invitationToken ? "invitation" : "policy",
        email: input.email,
        providerId: input.providerId,
        ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}),
      },
      signal,
    ),
  cancel: () => post(apiRouteUrl("api.google.join-cancel", {}).replace(API_BASE, "")),
  requestJoinEmailVerification: (accountId: string) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/join/verify-email`, {}),
  confirmJoinEmailVerification: (token: string) => post("/api/company-join/verify-email", { token }),
  completeExisting: (accountId: string) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/join/complete-existing`, {}),
  completeProvider: (invitationToken: string | null) =>
    post(apiRouteUrl("api.google.join-complete", {}).replace(API_BASE, ""), invitationToken ? { invitationToken } : {}),
};
