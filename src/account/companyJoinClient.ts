import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";

function post(path: string, body?: unknown): Promise<Response> {
  return apiFetch(`${API_BASE}${path}`, {
    method: "POST", credentials: "include",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

export const companyJoinClient = {
  metadata: (accountId: string) => apiFetch(
    `${API_BASE}/api/accounts/${encodeURIComponent(accountId)}/join/metadata`, { credentials: "include" },
  ),
  status: () => apiFetch(`${API_BASE}/api/company-join/status`, { credentials: "include" }),
  start: (input: { accountId: string; email: string; invitationToken: string | null }) => post(
    `/api/accounts/${encodeURIComponent(input.accountId)}/join/start`,
    { purpose: input.invitationToken ? "invitation" : "policy", email: input.email,
      ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}) },
  ),
  resend: () => post("/api/company-join/resend"),
  confirm: (token: string) => post("/api/company-join/confirm", { token }),
  cancel: () => post("/api/company-join/cancel"),
  completeNew: (input: { displayName: string; password: string; invitationToken: string | null }) => post(
    "/api/company-join/complete-password",
    { displayName: input.displayName, password: input.password,
      ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}) },
  ),
  completeExisting: (invitationToken: string | null) => post(
    "/api/company-join/complete-existing",
    invitationToken ? { invitationToken } : {},
  ),
};
