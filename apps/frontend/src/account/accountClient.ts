import { readIdentityProvider, linkIdentityProvider } from "./identityProviderClient";
import { joiningPolicyClient } from "./joiningPolicyClient";
import { apiFetchReauth } from "@/auth/apiFetchReauth";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch, API_BULK_TIMEOUT_MS } from "@/data/requestTimeout";
import type { BrowserAccountCommand } from "./accountCommands";
import type { MembershipStatus, Role } from "@capacitylens/shared/account/types";
import type { EndMasqueradePayload, StartMasqueradePayload } from "@capacitylens/shared/domain/masquerade";
import { buildPayloadOperationKey } from "./commandOutcome";
import type { CreateInvitationBody, CreateWorkspaceBody, InvitationSignupBody } from "./accountRequestTypes";
import { runCommand, buildCommandRequestInit, buildJsonCommandRequestInit } from "./commandRequest";
import type { ReauthAction } from "@/auth/reauthCoordinator";
import {
  clearMemberResourceLink,
  dismissMemberResourceLinkException,
  resourceAvatarsUrl,
  setMemberResourceLink,
} from "./memberResourceClient";
import { apiRouteUrl } from "@/api/queryClient";

interface ChangeMemberRoleInput {
  workspaceId: string;
  principalId: string;
  role: Role;
  command?: BrowserAccountCommand | undefined;
}

interface TransferOwnershipInput {
  workspaceId: string;
  targetPrincipalId: string;
  command?: BrowserAccountCommand | undefined;
}

interface ChangeMemberStatusInput {
  workspaceId: string;
  principalId: string;
  status: MembershipStatus;
  command?: BrowserAccountCommand | undefined;
}

export {
  type BrowserAccountCommand,
  createBrowserAccountCommand,
  clearStoredAccountCommands,
  bindStoredAccountCommandsToIdentity,
} from "./accountCommands";
export { hasUnknownAccountCommandOutcome, readUnknownAccountCommandOutcome } from "./commandOutcome";

type SetMemberSignInTrackingOptions = { workspaceId: string; enabled: boolean };
/** Provides typed request methods for account and membership endpoints. */
export const accountClient = {
  me(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl("api.auth.me", {}), { credentials: "include", ...(signal ? { signal } : {}) });
  },
  listWorkspaces(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl("api.accounts.index", {}), { credentials: "include", ...(signal ? { signal } : {}) });
  },
  diagnostics(signal?: AbortSignal): Promise<Response> {
    return apiFetch(`${API_BASE}/api/diagnostics`, { credentials: "include", ...(signal ? { signal } : {}) });
  },

  readIdentityProvider,
  linkIdentityProvider,

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

  async createWorkspace(body: CreateWorkspaceBody, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: await buildPayloadOperationKey("workspace-create", body),
      explicit: command,
      request: (resolved) =>
        apiFetch(apiRouteUrl("api.orgs.store", {}), buildJsonCommandRequestInit("POST", body, resolved)),
    });
  },

  /** Add the small example company to an empty company. Not idempotent: a second call is refused. */
  addExampleData(workspaceId: string): Promise<Response> {
    return apiFetch(apiRouteUrl("api.example-data", { params: { accountId: workspaceId } }), {
      method: "POST",
      credentials: "include",
    });
  },

  eraseWorkspace(workspaceId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `workspace-erase:${workspaceId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          apiRouteUrl("api.accounts.destroy", { params: { id: workspaceId } }),
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
          { timeoutMs: API_BULK_TIMEOUT_MS, action: "delete-company" satisfies ReauthAction },
        ),
      ambiguousStatus: 403,
    });
  },

  listMembers(workspaceId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl("api.members.index", { params: { accountId: workspaceId } }), {
      credentials: "include",
      ...(signal ? { signal } : {}),
    });
  },

  listResourceAvatars: (workspaceId: string) => apiFetch(resourceAvatarsUrl(workspaceId), { credentials: "include" }),
  setMemberResourceLink,
  clearMemberResourceLink,
  dismissMemberResourceLinkException,

  setMemberSignInTracking({ workspaceId, enabled }: SetMemberSignInTrackingOptions): Promise<Response> {
    return apiFetchReauth(
      apiRouteUrl("api.members.tracking", { params: { accountId: workspaceId } }),
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
      { action: "change-sign-in-tracking" satisfies ReauthAction },
    );
  },

  listInvitations(workspaceId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl("api.invites.index", { params: { accountId: workspaceId } }), {
      credentials: "include",
      ...(signal ? { signal } : {}),
    });
  },

  ...joiningPolicyClient,

  startMasquerade(workspaceId: string, body: StartMasqueradePayload): Promise<Response> {
    return apiFetch(apiRouteUrl("api.masquerade.start", { params: { accountId: workspaceId } }), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  masqueradeStatus(): Promise<Response> {
    return apiFetch(apiRouteUrl("api.masquerade.status", {}), { credentials: "include" });
  },

  endMasquerade(body: EndMasqueradePayload): Promise<Response> {
    return apiFetch(apiRouteUrl("api.masquerade.end", {}), {
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
          apiRouteUrl("api.members.role", { params: { accountId: workspaceId, userId: principalId } }),
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
          apiRouteUrl("api.members.status", { params: { accountId: workspaceId, userId: principalId } }),
          buildJsonCommandRequestInit("PATCH", { status }, resolved),
          { action: "change-member-status" satisfies ReauthAction },
        ),
    });
  },

  enableMemberAccess(workspaceId: string, principalId: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: `member-enable-access:${workspaceId}:${principalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          apiRouteUrl("api.members.enable-access", { params: { accountId: workspaceId, userId: principalId } }),
          buildJsonCommandRequestInit("POST", {}, resolved),
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
          apiRouteUrl("api.members.remove", { params: { accountId: workspaceId, userId: principalId } }),
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
          { action: "remove-member" satisfies ReauthAction },
        ),
    });
  },

  transferOwnership({ workspaceId, targetPrincipalId, command }: TransferOwnershipInput): Promise<Response> {
    return runCommand({
      operationKey: `ownership-transfer:${workspaceId}:${targetPrincipalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(
          apiRouteUrl("api.ownership.transfer", { params: { accountId: workspaceId } }),
          buildJsonCommandRequestInit("POST", { toUserId: targetPrincipalId }, resolved),
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
          apiRouteUrl("api.members.reset-password", { params: { accountId: workspaceId, userId: principalId } }),
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
          apiRouteUrl("api.members.revoke-sessions", { params: { accountId: workspaceId, userId: principalId } }),
          buildCommandRequestInit({ method: "POST", credentials: "include" }, resolved),
          { action: "revoke-member-sessions" satisfies ReauthAction },
        ),
    });
  },

  async createInvitation(body: CreateInvitationBody, command?: BrowserAccountCommand): Promise<Response> {
    const accountId = body.accountId;
    return runCommand({
      operationKey: await buildPayloadOperationKey(`invitation-create:${accountId}`, body),
      explicit: command,
      request: (resolved) =>
        apiFetchReauth(apiRouteUrl("api.invites.create", {}), buildJsonCommandRequestInit("POST", body, resolved), {
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
          apiRouteUrl("api.invites.revoke", { params: { accountId: workspaceId, id: invitationId } }),
          buildCommandRequestInit({ method: "DELETE", credentials: "include" }, resolved),
          { action: "revoke-invitation" satisfies ReauthAction },
        ),
    });
  },

  previewInvitation(token: string): Promise<Response> {
    return apiFetch(apiRouteUrl("api.invites.preview", { params: { token } }), {
      credentials: "include",
    });
  },

  acceptInvitation(token: string, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: null,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl("api.invites.accept", { params: { token } }),
          buildCommandRequestInit({ method: "POST", credentials: "include" }, resolved),
        ),
    });
  },

  signupWithInvitation(token: string, body: InvitationSignupBody, command?: BrowserAccountCommand): Promise<Response> {
    return runCommand({
      operationKey: null,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl("api.invites.sign-up", { params: { token } }),
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
