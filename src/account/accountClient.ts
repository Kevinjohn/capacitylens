import { apiFetchReauth } from "../auth/apiFetchReauth";
import { API_BASE } from "../data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "../data/requestTimeout";
import type { BrowserAccountCommand } from "./accountCommands";
import { buildPayloadOperationKey } from "./commandOutcome";
import { runCommand, buildCommandRequestInit, buildJsonCommandRequestInit } from "./commandRequest";

interface ChangeMemberRoleInput {
  workspaceId: string;
  principalId: string;
  role: string;
  command?: BrowserAccountCommand | undefined;
}

interface ChangeMemberStatusInput {
  workspaceId: string;
  principalId: string;
  status: string;
  command?: BrowserAccountCommand | undefined;
}

export {
  type BrowserAccountCommand,
  createBrowserAccountCommand,
  clearStoredAccountCommands,
  bindStoredAccountCommandsToIdentity,
} from "./accountCommands";
export { hasUnknownAccountCommandOutcome, readUnknownAccountCommandOutcome } from "./commandOutcome";

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
    return runCommand({
      operationKey: `own-session:${sessionId}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          `${API_BASE}/api/account/sessions/${encodeURIComponent(sessionId)}`,
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
        ),
    });
  },

  async createWorkspace(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: await buildPayloadOperationKey("workspace-create", body),
      explicit: command,
      request: (resolved) => apiFetch(`${API_BASE}/api/orgs`, buildJsonCommandRequestInit("POST", body, resolved)),
    });
  },

  eraseWorkspace(workspaceId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `workspace-erase:${workspaceId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}`,
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
          API_BULK_TIMEOUT_MS,
        ),
      ambiguousStatus: 403,
    });
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

  changeMemberRole({ workspaceId, principalId, role, command }: ChangeMemberRoleInput): Promise<Response> {
    return runCommand({
      operationKey: `member-role:${workspaceId}:${principalId}:${role}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
          buildJsonCommandRequestInit("PATCH", { role }, resolved),
        ),
    });
  },

  changeMemberStatus({ workspaceId, principalId, status, command }: ChangeMemberStatusInput): Promise<Response> {
    return runCommand({
      operationKey: `member-status:${workspaceId}:${principalId}:${status}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/status`,
          buildJsonCommandRequestInit("PATCH", { status }, resolved),
        ),
    });
  },

  removeMember(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `member-remove:${workspaceId}:${principalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}`,
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
        ),
    });
  },

  transferOwnership(
    workspaceId: string,
    targetPrincipalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand({
      operationKey: `ownership-transfer:${workspaceId}:${targetPrincipalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/transfer-ownership`,
          buildJsonCommandRequestInit("POST", { toUserId: targetPrincipalId }, resolved),
        ),
    });
  },

  issuePasswordReset(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `password-reset:${workspaceId}:${principalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/reset-password`,
          buildCommandRequestInit({ method: "POST", credentials: "include" }, resolved),
        ),
    });
  },

  revokeMemberSessions(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `member-sessions:${workspaceId}:${principalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(principalId)}/revoke-sessions`,
          buildCommandRequestInit({ method: "POST", credentials: "include" }, resolved),
        ),
    });
  },

  async createInvitation(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    const accountId =
      typeof body === "object" && body !== null && "accountId" in body
        ? String((body as { accountId: unknown }).accountId)
        : "unknown";
    return runCommand({
      operationKey: await buildPayloadOperationKey(`invitation-create:${accountId}`, body),
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(`${API_BASE}/api/invites`, buildJsonCommandRequestInit("POST", body, resolved)),
    });
  },

  revokeInvitation(workspaceId: string, invitationId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `invitation-revoke:${workspaceId}:${invitationId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(invitationId)}`,
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
        ),
    });
  },

  previewInvitation(token: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/preview`, {
      credentials: "include",
    });
  },

  acceptInvitation(token: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: null,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          `${API_BASE}/api/invites/${encodeURIComponent(token)}/accept`,
          buildCommandRequestInit({ method: "POST", credentials: "include" }, resolved),
        ),
    });
  },

  signupWithInvitation(token: string, body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: null,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          `${API_BASE}/api/invites/${encodeURIComponent(token)}/signup`,
          buildJsonCommandRequestInit("POST", body, resolved),
        ),
    });
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
