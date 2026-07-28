import type { InvitationRole } from "@capacitylens/shared/account/types";
import { isAccountRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { accountClient, accountCommandOutcomeUnknown } from "./accountClient";
import { hasDuplicateIdentity } from "../lib/arrayIdentity";

export interface TeamMember {
  userId: string;
  role: Role;
  status: "active";
  createdAt: string;
  name: string | null;
  email: string | null;
  isSelf: boolean;
  mayResetPassword: boolean;
  mayRevokeSessions: boolean;
}

export interface TeamInvitation {
  id: string;
  role: InvitationRole;
  preauthEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface OneTimeToken {
  id?: string;
  token: string;
  expiresAt?: string;
}

export type TeamAccessResult<T> =
  | { kind: "ok"; status: number; value: T }
  | { kind: "rejected"; status: number; message: string | null }
  | { kind: "unknown"; status: number; message: string | null }
  | { kind: "invalid"; status: number; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function parseMembers(value: unknown): TeamMember[] | null {
  if (!isRecord(value) || !Array.isArray(value.members)) return null;
  const members: TeamMember[] = [];
  for (const row of value.members) {
    if (
      !isRecord(row) ||
      typeof row.userId !== "string" ||
      row.userId.length === 0 ||
      !isAccountRole(row.role) ||
      row.status !== "active" ||
      !isTimestamp(row.createdAt) ||
      !(row.name === null || typeof row.name === "string") ||
      !(row.email === null || typeof row.email === "string") ||
      typeof row.isSelf !== "boolean" ||
      !(
        row.mayResetPassword === undefined ||
        typeof row.mayResetPassword === "boolean"
      ) ||
      !(
        row.mayRevokeSessions === undefined ||
        typeof row.mayRevokeSessions === "boolean"
      )
    ) {
      console.warn(
        "teamAccessClient: dropped an unsupported member-directory row",
        row,
      );
      continue;
    }
    members.push({
      userId: row.userId,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
      name: row.name,
      email: row.email,
      isSelf: row.isSelf,
      mayResetPassword: row.mayResetPassword === true,
      mayRevokeSessions: row.mayRevokeSessions === true,
    });
  }
  if (value.members.length > 0 && members.length === 0) return null;
  return hasDuplicateIdentity(members, (member) => member.userId)
    ? null
    : members;
}

function parseInvitations(value: unknown): TeamInvitation[] | null {
  if (!isRecord(value) || !Array.isArray(value.invites)) return null;
  const invitations: TeamInvitation[] = [];
  for (const row of value.invites) {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      !isAccountRole(row.role) ||
      row.role === "owner" ||
      !(
        row.preauthEmail === undefined ||
        row.preauthEmail === null ||
        typeof row.preauthEmail === "string"
      ) ||
      !isTimestamp(row.expiresAt) ||
      !(row.usedAt === null || isTimestamp(row.usedAt)) ||
      !isTimestamp(row.createdAt)
    ) {
      console.warn(
        "teamAccessClient: dropped an unsupported invitation-directory row",
        row,
      );
      continue;
    }
    invitations.push({
      id: row.id,
      role: row.role,
      preauthEmail:
        typeof row.preauthEmail === "string" ? row.preauthEmail : null,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    });
  }
  if (value.invites.length > 0 && invitations.length === 0) return null;
  return hasDuplicateIdentity(invitations, (invitation) => invitation.id)
    ? null
    : invitations;
}

function parseToken(value: unknown): OneTimeToken | null {
  if (
    !isRecord(value) ||
    typeof value.token !== "string" ||
    value.token.length === 0
  )
    return null;
  if (
    value.id !== undefined &&
    (typeof value.id !== "string" || value.id.length === 0)
  )
    return null;
  if (value.expiresAt !== undefined && !isTimestamp(value.expiresAt))
    return null;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    token: value.token,
    ...(typeof value.expiresAt === "string"
      ? { expiresAt: value.expiresAt }
      : {}),
  };
}

async function failureMessage(response: Response): Promise<string | null> {
  const readable =
    typeof response.clone === "function" ? response.clone() : response;
  const body: unknown = await readable.json().catch(() => null);
  if (!isRecord(body)) return null;
  return typeof body.error === "string" && body.error.length > 0
    ? body.error
    : null;
}

async function commandResult<T>(
  response: Response,
  decode: (body: unknown) => T | null,
  expectedStatus?: number,
): Promise<TeamAccessResult<T>> {
  const success =
    expectedStatus === undefined
      ? response.ok
      : response.status === expectedStatus;
  if (!success) {
    const message = await failureMessage(response);
    return (await accountCommandOutcomeUnknown(response))
      ? { kind: "unknown", status: response.status, message }
      : { kind: "rejected", status: response.status, message };
  }
  const body: unknown = await response.json().catch(() => null);
  const value = decode(body);
  return value === null
    ? {
        kind: "invalid",
        status: response.status,
        message: "The server returned an invalid response.",
      }
    : { kind: "ok", status: response.status, value };
}

async function readResult<T>(
  response: Response,
  decode: (body: unknown) => T | null,
): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    return {
      kind: "rejected",
      status: response.status,
      message: await failureMessage(response),
    };
  }
  const body: unknown = await response.json().catch(() => null);
  const value = decode(body);
  return value === null
    ? {
        kind: "invalid",
        status: response.status,
        message: "The server returned an invalid response.",
      }
    : { kind: "ok", status: response.status, value };
}

const noContent = (): true => true;

/** Typed account-administration boundary. Raw Response handling and untrusted payload codecs stay
 * here; the Team & access controller consumes semantic outcomes only. */
export const teamAccessClient = {
  async listMembers(
    workspaceId: string,
  ): Promise<TeamAccessResult<TeamMember[]>> {
    return readResult(
      await accountClient.listMembers(workspaceId),
      parseMembers,
    );
  },

  async listInvitations(
    workspaceId: string,
  ): Promise<TeamAccessResult<TeamInvitation[]>> {
    return readResult(
      await accountClient.listInvitations(workspaceId),
      parseInvitations,
    );
  },

  async changeMemberRole(
    workspaceId: string,
    principalId: string,
    role: Role,
  ): Promise<TeamAccessResult<true>> {
    return commandResult(
      await accountClient.changeMemberRole(workspaceId, principalId, role),
      noContent,
    );
  },

  async removeMember(
    workspaceId: string,
    principalId: string,
  ): Promise<TeamAccessResult<true>> {
    return commandResult(
      await accountClient.removeMember(workspaceId, principalId),
      noContent,
    );
  },

  async transferOwnership(
    workspaceId: string,
    principalId: string,
  ): Promise<TeamAccessResult<true>> {
    return commandResult(
      await accountClient.transferOwnership(workspaceId, principalId),
      noContent,
    );
  },

  async issuePasswordReset(
    workspaceId: string,
    principalId: string,
  ): Promise<TeamAccessResult<OneTimeToken>> {
    return commandResult(
      await accountClient.issuePasswordReset(workspaceId, principalId),
      parseToken,
      201,
    );
  },

  async revokeMemberSessions(
    workspaceId: string,
    principalId: string,
  ): Promise<TeamAccessResult<true>> {
    return commandResult(
      await accountClient.revokeMemberSessions(workspaceId, principalId),
      noContent,
      204,
    );
  },

  async createInvitation(input: {
    accountId: string;
    role: InvitationRole;
    preauthEmail?: string;
  }): Promise<TeamAccessResult<OneTimeToken>> {
    return commandResult(
      await accountClient.createInvitation(input),
      parseToken,
      201,
    );
  },

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
  ): Promise<TeamAccessResult<true>> {
    return commandResult(
      await accountClient.revokeInvitation(workspaceId, invitationId),
      noContent,
    );
  },
};
