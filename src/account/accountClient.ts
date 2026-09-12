import { apiFetchReauth } from "../auth/apiFetchReauth";
import { API_BASE } from "../data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "../data/requestTimeout";
import type { BrowserAccountCommand } from "./accountCommands";
import { buildPayloadOperationKey } from "./commandOutcome";
import { runCommand, buildCommandRequestInit, buildJsonCommandRequestInit } from "./commandRequest";
import type { ReauthAction } from "../auth/reauthCoordinator";

interface ChangeMemberRoleInput {
  workspaceId: string;
  principalId: string;
  role: string;
  command?: BrowserAccountCommand | undefined;
}

/** The four steps that move an existing request, plus the cancellation that ends it. */
export type OwnershipTransferStep = "accept" | "withdraw" | "decline" | "complete" | "cancel";

interface InitiateOwnershipTransferInput {
  workspaceId: string;
  targetPrincipalId: string;
  /** The live request this nomination replaces, at the revision it was read at. Omitted when the
   *  caller believes there is none; the server refuses either belief if it is wrong. */
  replaces?: { requestId: string; revision: string } | undefined;
  command?: BrowserAccountCommand | undefined;
}

interface OwnershipTransferCommandInput {
  workspaceId: string;
  requestId: string;
  step: OwnershipTransferStep;
  expectedRevision: string;
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
    return apiFetch(`${API_BASE}/api/auth/me`, { credentials: "include", ...(signal ? { signal } : {}) });
  },

  listWorkspaces(signal?: AbortSignal): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts`, { credentials: "include", ...(signal ? { signal } : {}) });
  },

  diagnostics(signal?: AbortSignal): Promise<Response> {
    return apiFetch(`${API_BASE}/api/diagnostics`, { credentials: "include", ...(signal ? { signal } : {}) });
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
    return apiFetchReauth(
      `${API_BASE}/api/identity/link-provider`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackURL, errorCallbackURL: callbackURL }),
      },
      { action: "connect-provider" satisfies ReauthAction },
    );
  },

  getSsoReadiness(workspaceId: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/sso-readiness`, {
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
      { action: "correct-member-email" satisfies ReauthAction },
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
      { action: "remove-federated-link" satisfies ReauthAction },
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
          { timeoutMs: API_BULK_TIMEOUT_MS, action: "delete-company" satisfies ReauthAction },
        ),
      ambiguousStatus: 403,
    });
  },

  listMembers(workspaceId: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/members`, {
      credentials: "include",
    });
  },

  setMemberSignInTracking(workspaceId: string, enabled: boolean): Promise<Response> {
    return apiFetchReauth(
      `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/member-sign-in-tracking`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
      { action: "change-sign-in-tracking" satisfies ReauthAction },
    );
  },

  listInvitations(workspaceId: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/invites`, {
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
          { action: "change-member-role" satisfies ReauthAction },
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
          { action: "change-member-status" satisfies ReauthAction },
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
          { action: "remove-member" satisfies ReauthAction },
        ),
    });
  },

  readOwnershipTransfer(workspaceId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/ownership-transfer`, {
      credentials: "include",
      ...(signal ? { signal } : {}),
    });
  },

  initiateOwnershipTransfer(input: InitiateOwnershipTransferInput): Promise<Response> {
    const { workspaceId, targetPrincipalId, replaces, command } = input;
    return runCommand({
      operationKey: `ownership-transfer:initiate:${workspaceId}:${targetPrincipalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/ownership-transfer`,
          buildJsonCommandRequestInit(
            "POST",
            {
              toUserId: targetPrincipalId,
              // Both halves or neither: half a predicate names no particular predecessor, and the
              // server refuses it rather than replacing whatever happens to be live.
              ...(replaces ? { expectedRequestId: replaces.requestId, expectedRevision: replaces.revision } : {}),
            },
            resolved,
          ),
          { action: "transfer-ownership" satisfies ReauthAction },
        ),
    });
  },

  /**
   * One ceremony step against one request at one revision.
   *
   * `cancel` is the DELETE; the other four are POSTs to their own sub-path. The revision travels in
   * the body for all five, including the DELETE, because it is the compare half of the transition,
   * not an identifier — and it is part of the command payload the server hashes, so a retry naming
   * a different revision is refused rather than replayed.
   */
  commandOwnershipTransfer(input: OwnershipTransferCommandInput): Promise<Response> {
    const { workspaceId, requestId, step, expectedRevision, command } = input;
    const base = `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/ownership-transfer/${encodeURIComponent(requestId)}`;
    return runCommand({
      operationKey: `ownership-transfer:${step}:${workspaceId}:${requestId}:${expectedRevision}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          step === "cancel" ? base : `${base}/${step}`,
          buildJsonCommandRequestInit(step === "cancel" ? "DELETE" : "POST", { expectedRevision }, resolved),
          { action: "transfer-ownership" satisfies ReauthAction },
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
          { action: "issue-password-reset" satisfies ReauthAction },
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
          { action: "revoke-member-sessions" satisfies ReauthAction },
        ),
    });
  },

  async createInvitation(body: unknown, command?: BrowserAccountCommand): Promise<Response> {
    const accountId =
      typeof body === "object" && body !== null && "accountId" in body ? String(body.accountId) : "unknown";
    return runCommand({
      operationKey: await buildPayloadOperationKey(`invitation-create:${accountId}`, body),
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(`${API_BASE}/api/invites`, buildJsonCommandRequestInit("POST", body, resolved), {
          action: "create-invitation" satisfies ReauthAction,
        }),
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
          { action: "revoke-invitation" satisfies ReauthAction },
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
