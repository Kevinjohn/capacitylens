import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";

function post(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  return apiFetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
}

export const companyJoinClient = {
  metadata: (accountId: string) =>
    apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(accountId)}/join/metadata`, { credentials: "include" }),
  status: () => apiFetch(`${API_BASE}/api/company-join/status`, { credentials: "include" }),
  startProvider: (
    input: { accountId: string; email: string; invitationToken: string | null; providerId: "google" | "github" },
    signal?: AbortSignal,
  ) =>
    post(
      `/api/accounts/${encodeURIComponent(input.accountId)}/join/provider/start`,
      {
        purpose: input.invitationToken ? "invitation" : "policy",
        email: input.email,
        providerId: input.providerId,
        ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}),
      },
      signal,
    ),
  microsoftStatus: () => apiFetch(`${API_BASE}/api/account/microsoft/status`, { credentials: "include" }),
  startMicrosoft: (
    input: { accountId: string; email: string; invitationToken: string | null },
    signal?: AbortSignal,
  ) => {
    const target = new URL(`/join/${encodeURIComponent(input.accountId)}`, window.location.origin);
    if (input.invitationToken) target.searchParams.set("invite", input.invitationToken);
    const failure = new URL(target);
    failure.searchParams.set("externalSignInError", "1");
    return post(
      "/api/account/microsoft/start",
      {
        purpose: "join",
        accountId: input.accountId,
        email: input.email,
        ...(input.invitationToken ? { inviteToken: input.invitationToken } : {}),
        callbackURL: target.href,
        errorCallbackURL: failure.href,
      },
      signal,
    );
  },
  microsoftResend: () => post("/api/account/microsoft/resend"),
  microsoftCancel: () => post("/api/account/microsoft/cancel"),
  cancel: () => post("/api/company-join/cancel"),
  requestJoinEmailVerification: (accountId: string) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/join/verify-email`, {}),
  confirmJoinEmailVerification: (token: string) => post("/api/company-join/verify-email", { token }),
  completeExisting: (accountId: string) =>
    post(`/api/accounts/${encodeURIComponent(accountId)}/join/complete-existing`, {}),
  completeProvider: (invitationToken: string | null) =>
    post("/api/company-join/complete-provider", invitationToken ? { invitationToken } : {}),
  completeMicrosoft: (invitationToken: string | null) =>
    post("/api/company-join/complete-microsoft", invitationToken ? { invitationToken } : {}),
};
