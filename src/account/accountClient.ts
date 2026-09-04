import { apiFetchReauth } from "../auth/apiFetchReauth";
import { API_BASE } from "../data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "../data/requestTimeout";
import type { BrowserAccountCommand } from "./accountCommands";
import { payloadOperationKey } from "./commandOutcome";
import { runCommand, commandInit, jsonCommandInit } from "./commandRequest";

export {
  type BrowserAccountCommand,
  newBrowserAccountCommand,
  clearStoredAccountCommands,
  bindStoredAccountCommandsToIdentity,
} from "./accountCommands";
export { accountCommandOutcomeWasUnknown, accountCommandOutcomeUnknown } from "./commandOutcome";

export const accountClient = {
  me(signal?: AbortSignal): Promise<Response> {
    // apiFetch (not raw fetch) so the audit-degradation header gets the same announceAuditWarning
    // surfacing as every other account/sync request path.
    return apiFetch(`${API_BASE}/api/auth/me`, { credentials: "include", signal });
  },

  listWorkspaces(signal?: AbortSignal): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts`, { credentials: "include", signal });
  },

  signOut(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account/sign-out`, {
      method: "POST",
      credentials: "include",
    });
  },

  listSessions(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account/sessions`, {
      credentials: "include",
    });
  },

  getIdentityProvider(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/identity/provider`, { credentials: "include" });
  },

  linkIdentityProvider(callbackURL: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/identity/link-provider`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callbackURL, errorCallbackURL: callbackURL }),
    });
  },

  getSsoReadiness(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/sso-readiness`, {
      credentials: "include",
    });
  },

  correctMemberEmail(workspaceId: string, principalId: string, email: string): Promise<Response> {
    return apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/email`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      },
    );
  },

  removeFederatedLink(
    workspaceId: string,
    principalId: string,
    coordinate: { rowId: string; providerId: string; subject: string },
  ): Promise<Response> {
    return apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/federated-link`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coordinate),
      },
    );
  },

  revokeOwnSession(sessionId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`own-session:${sessionId}`, command, (resolved) =>
      apiFetch(
        `${API_BASE}/api/account/sessions/${encodeURIComponent(sessionId)}`,
        commandInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
    );
  },

  async createWorkspace(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(await payloadOperationKey("workspace-create", body), command, (resolved) =>
      apiFetch(`${API_BASE}/api/orgs`, jsonCommandInit("POST", body, resolved)),
    );
  },

  eraseWorkspace(workspaceId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(
      `workspace-erase:${workspaceId}`,
      command,
      (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}`,
          commandInit({ method: "DELETE", credentials: "include" }, resolved),
          API_BULK_TIMEOUT_MS,
        ),
      403,
    );
  },

  listMembers(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members`, {
      credentials: "include",
    });
  },

  setMemberSignInTracking(workspaceId: string, enabled: boolean): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/member-sign-in-tracking`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  },

  listInvitations(workspaceId: string): Promise<Response> {
    return apiFetchReauth(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites`, {
      credentials: "include",
    });
  },

  startMasquerade(workspaceId: string, body: unknown): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/masquerade`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  masqueradeStatus(): Promise<Response> {
    return apiFetch(`${API_BASE}/api/masquerade`, { credentials: "include" });
  },

  endMasquerade(body: unknown): Promise<Response> {
    return apiFetch(`${API_BASE}/api/masquerade`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  changeMemberRole(
    workspaceId: string,
    principalId: string,
    role: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`member-role:${workspaceId}:${principalId}:${role}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
        jsonCommandInit("PATCH", { role }, resolved),
      ),
    );
  },

  changeMemberStatus(
    workspaceId: string,
    principalId: string,
    status: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`member-status:${workspaceId}:${principalId}:${status}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/status`,
        jsonCommandInit("PATCH", { status }, resolved),
      ),
    );
  },

  removeMember(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`member-remove:${workspaceId}:${principalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
        commandInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
    );
  },

  transferOwnership(
    workspaceId: string,
    targetPrincipalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand(`ownership-transfer:${workspaceId}:${targetPrincipalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/transfer-ownership`,
        jsonCommandInit("POST", { toUserId: targetPrincipalId }, resolved),
      ),
    );
  },

  issuePasswordReset(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`password-reset:${workspaceId}:${principalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/reset-password`,
        commandInit({ method: "POST", credentials: "include" }, resolved),
      ),
    );
  },

  revokeMemberSessions(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`member-sessions:${workspaceId}:${principalId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/revoke-sessions`,
        commandInit({ method: "POST", credentials: "include" }, resolved),
      ),
    );
  },

  async createInvitation(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    const accountId =
      typeof body === "object" && body !== null && "accountId" in body
        ? String((body as { accountId: unknown }).accountId)
        : "unknown";
    return runCommand(await payloadOperationKey(`invitation-create:${accountId}`, body), command, (resolved) =>
      apiFetchReauth(`${API_BASE}/api/invites`, jsonCommandInit("POST", body, resolved)),
    );
  },

  revokeInvitation(workspaceId: string, invitationId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(`invitation-revoke:${workspaceId}:${invitationId}`, command, (resolved) =>
      apiFetchReauth(
        `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(invitationId)}`,
        commandInit({ method: "DELETE", credentials: "include" }, resolved),
      ),
    );
  },

  previewInvitation(token: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/preview`, {
      credentials: "include",
    });
  },

  acceptInvitation(token: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(null, command, (resolved) =>
      apiFetch(
        `${API_BASE}/api/invites/${encodeURIComponent(token)}/accept`,
        commandInit({ method: "POST", credentials: "include" }, resolved),
      ),
    );
  },

  signupWithInvitation(token: string, body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand(null, command, (resolved) =>
      apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/signup`, jsonCommandInit("POST", body, resolved)),
    );
  },

  reconcileCommand(command: BrowserAccountCommand, operation: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/account-commands/reconcile`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        operation,
      }),
    });
  },
};
