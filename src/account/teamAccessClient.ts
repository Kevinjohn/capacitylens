import type { InvitationRole, MembershipStatus } from "@capacitylens/shared/account/types";
import { isAccountRole, isMembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { accountClient, accountCommandOutcomeUnknown } from "./accountClient";
import { hasDuplicateIdentity } from "../lib/arrayIdentity";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { apiErrorFromBody, readApiError } from "../lib/readApiError";

export interface TeamMember {
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: string;
  name: string | null;
  email: string | null;
  /** Coarse, account-opted-in observation. Null means tracking is off; no timestamp is collected. */
  signInConfirmed: boolean | null;
  isSelf: boolean;
  mayResetPassword: boolean;
  mayRevokeSessions: boolean;
}

export interface TeamDirectory {
  members: TeamMember[];
  signInTrackingEnabled: boolean;
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

const isTimestamp = isIsoInstant;

function parseMembers(value: unknown): TeamDirectory | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.members) ||
    !(value.signInTrackingEnabled === undefined || typeof value.signInTrackingEnabled === "boolean")
  )
    return null;
  const signInTrackingEnabled = value.signInTrackingEnabled === true;
  const members: TeamMember[] = [];
  for (const row of value.members) {
    if (
      !isRecord(row) ||
      typeof row.userId !== "string" ||
      row.userId.length === 0 ||
      !isAccountRole(row.role) ||
      !isMembershipStatus(row.status) ||
      !isTimestamp(row.createdAt) ||
      !(
        row.signInConfirmed === undefined ||
        row.signInConfirmed === null ||
        typeof row.signInConfirmed === "boolean"
      ) ||
      !(row.name === null || typeof row.name === "string") ||
      !(row.email === null || typeof row.email === "string") ||
      typeof row.isSelf !== "boolean" ||
      !(row.mayResetPassword === undefined || typeof row.mayResetPassword === "boolean") ||
      !(row.mayRevokeSessions === undefined || typeof row.mayRevokeSessions === "boolean")
    ) {
      console.warn("teamAccessClient: dropped an unsupported member-directory row", row);
      continue;
    }
    members.push({
      userId: row.userId,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
      name: row.name,
      email: row.email,
      signInConfirmed: typeof row.signInConfirmed === "boolean" ? row.signInConfirmed : null,
      isSelf: row.isSelf,
      mayResetPassword: row.mayResetPassword === true,
      mayRevokeSessions: row.mayRevokeSessions === true,
    });
  }
  if (value.members.length > 0 && members.length === 0) return null;
  return hasDuplicateIdentity(members, (member) => member.userId) ? null : { members, signInTrackingEnabled };
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
      !(row.preauthEmail === undefined || row.preauthEmail === null || typeof row.preauthEmail === "string") ||
      !isTimestamp(row.expiresAt) ||
      !(row.usedAt === null || isTimestamp(row.usedAt)) ||
      !isTimestamp(row.createdAt)
    ) {
      console.warn("teamAccessClient: dropped an unsupported invitation-directory row", row);
      continue;
    }
    invitations.push({
      id: row.id,
      role: row.role,
      preauthEmail: typeof row.preauthEmail === "string" ? row.preauthEmail : null,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    });
  }
  if (value.invites.length > 0 && invitations.length === 0) return null;
  return hasDuplicateIdentity(invitations, (invitation) => invitation.id) ? null : invitations;
}

function parseToken(value: unknown): OneTimeToken | null {
  if (!isRecord(value) || typeof value.token !== "string") return null;
  // Both current issuers return compact opaque strings. Keep the provider-owned alphabet opaque,
  // but reject values that cannot safely form one write-once URL segment or indicate a skewed body.
  const containsUnsafeCharacter = Array.from(value.token).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    value.token.length === 0 ||
    value.token.length > 4_096 ||
    value.token !== value.token.trim() ||
    containsUnsafeCharacter
  ) {
    return null;
  }
  if (value.id !== undefined && (typeof value.id !== "string" || value.id.length === 0)) return null;
  if (value.expiresAt !== undefined && !isTimestamp(value.expiresAt)) return null;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    token: value.token,
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
  };
}

async function commandResult<T>(
  response: Response,
  decode: (body: unknown) => T | null,
  expectedStatus?: number,
): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    const clonedMessage = typeof response.clone === "function" ? await readApiError(response) : undefined;
    const body: unknown = await response.json().catch(() => null);
    const message = clonedMessage ?? apiErrorFromBody(body) ?? null;
    return (await accountCommandOutcomeUnknown(response, body))
      ? { kind: "unknown", status: response.status, message }
      : { kind: "rejected", status: response.status, message };
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    console.warn(
      `teamAccessClient: expected status ${expectedStatus} but received equivalent success ${response.status}; decoding the response body.`,
    );
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

async function readResult<T>(response: Response, decode: (body: unknown) => T | null): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    return {
      kind: "rejected",
      status: response.status,
      message: (await readApiError(response)) ?? null,
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
  async listMembers(workspaceId: string): Promise<TeamAccessResult<TeamDirectory>> {
    return readResult(await accountClient.listMembers(workspaceId), parseMembers);
  },

  async setMemberSignInTracking(workspaceId: string, enabled: boolean): Promise<TeamAccessResult<boolean>> {
    return readResult(await accountClient.setMemberSignInTracking(workspaceId, enabled), (body) =>
      isRecord(body) && typeof body.enabled === "boolean" ? body.enabled : null,
    );
  },

  async listInvitations(workspaceId: string): Promise<TeamAccessResult<TeamInvitation[]>> {
    return readResult(await accountClient.listInvitations(workspaceId), parseInvitations);
  },

  async changeMemberRole(workspaceId: string, principalId: string, role: Role): Promise<TeamAccessResult<true>> {
    return commandResult(await accountClient.changeMemberRole(workspaceId, principalId, role), noContent);
  },

  async changeMemberStatus(
    workspaceId: string,
    principalId: string,
    status: MembershipStatus,
  ): Promise<TeamAccessResult<true>> {
    return commandResult(await accountClient.changeMemberStatus(workspaceId, principalId, status), noContent);
  },

  async removeMember(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return commandResult(await accountClient.removeMember(workspaceId, principalId), noContent);
  },

  async transferOwnership(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return commandResult(await accountClient.transferOwnership(workspaceId, principalId), noContent);
  },

  async issuePasswordReset(workspaceId: string, principalId: string): Promise<TeamAccessResult<OneTimeToken>> {
    return commandResult(await accountClient.issuePasswordReset(workspaceId, principalId), parseToken, 201);
  },

  async revokeMemberSessions(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return commandResult(await accountClient.revokeMemberSessions(workspaceId, principalId), noContent, 204);
  },

  async createInvitation(input: {
    accountId: string;
    role: InvitationRole;
    preauthEmail?: string;
  }): Promise<TeamAccessResult<OneTimeToken>> {
    return commandResult(await accountClient.createInvitation(input), parseToken, 201);
  },

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<TeamAccessResult<true>> {
    return commandResult(await accountClient.revokeInvitation(workspaceId, invitationId), noContent);
  },
};
