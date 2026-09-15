import type { InvitationRole, MembershipStatus } from "@capacitylens/shared/account/types";
import { isAccountRole, isMembershipStatus } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { accountClient } from "./accountClient";
import { hasDuplicateIdentity } from "../lib/hasDuplicateIdentity";
import {
  isNullableString,
  isRecord,
  isTimestamp,
  readCommandResult,
  readResult,
  type TeamAccessResult,
} from "./accessResult";
import { ownershipTransferAccess } from "./ownershipTransferAccess";

export { resolveRejectionMessage, type TeamAccessResult } from "./accessResult";
export type {
  OwnershipTransferOutcomeView,
  OwnershipTransferTerminalView,
  OwnershipTransferProjectionView,
  OwnershipTransferView,
} from "./ownershipTransferAccess";

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
  resourceLink?: {
    resourceId: string;
    revision: string;
    resourceName?: string | null;
    resourceStatus?: "active" | "disabled" | "archived" | null;
  } | null;
  resourceLinkException?: {
    proposedResourceId: string | null;
    reason: "resource_unavailable" | "resource_already_linked" | "member_already_linked";
  } | null;
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
  proposedResourceId?: string;
}

export interface OneTimeToken {
  id?: string;
  token: string;
  expiresAt?: string;
}

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";

const isOptionalNullableBoolean = (value: unknown): value is boolean | null | undefined =>
  value === undefined || value === null || typeof value === "boolean";

function hasValidMemberIdentity(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamMember, "userId" | "role" | "status" | "createdAt"> {
  return (
    typeof row.userId === "string" &&
    row.userId.length > 0 &&
    isAccountRole(row.role) &&
    isMembershipStatus(row.status) &&
    isTimestamp(row.createdAt)
  );
}

function hasValidMemberAccess(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamMember, "isSelf"> {
  return (
    typeof row.isSelf === "boolean" &&
    isOptionalNullableBoolean(row.signInConfirmed) &&
    isOptionalBoolean(row.mayResetPassword) &&
    isOptionalBoolean(row.mayRevokeSessions)
  );
}

function parseMember(row: unknown): TeamMember | null {
  if (!isRecord(row)) return null;
  if (!hasValidMemberIdentity(row)) return null;
  if (!hasValidMemberAccess(row)) return null;
  if (!isNullableString(row.name) || !isNullableString(row.email)) return null;
  const resourceLink = parseMemberResourceLink(row.resourceLink);
  if (resourceLink === undefined) return null;
  const resourceLinkException = parseMemberResourceLinkException(row.resourceLinkException);
  if (resourceLinkException === undefined) return null;
  return {
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
    resourceLink,
    resourceLinkException,
  };
}

function parseMemberResourceLinkException(value: unknown): TeamMember["resourceLinkException"] | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  if (
    (value.proposedResourceId !== null && typeof value.proposedResourceId !== "string") ||
    (value.reason !== "resource_unavailable" &&
      value.reason !== "resource_already_linked" &&
      value.reason !== "member_already_linked")
  )
    return undefined;
  return { proposedResourceId: value.proposedResourceId, reason: value.reason };
}

function parseMemberResourceStatus(value: unknown): "active" | "disabled" | "archived" | null | undefined {
  if (value === undefined || value === null) return null;
  if (value === "active" || value === "disabled" || value === "archived") return value;
  return undefined;
}

// eslint-disable-next-line complexity
function parseMemberResourceLink(value: unknown): TeamMember["resourceLink"] | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.resourceId !== "string" || value.resourceId.length === 0) return undefined;
  if (typeof value.revision !== "string" || value.revision.length === 0) return undefined;
  if (value.resourceName !== undefined && value.resourceName !== null && typeof value.resourceName !== "string")
    return undefined;
  const resourceStatus = parseMemberResourceStatus(value.resourceStatus);
  if (resourceStatus === undefined) return undefined;
  return {
    resourceId: value.resourceId,
    revision: value.revision,
    resourceName: typeof value.resourceName === "string" ? value.resourceName : null,
    resourceStatus,
  };
}

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
    const member = parseMember(row);
    if (member === null) {
      console.warn("teamAccessClient: dropped an unsupported member-directory row", row);
      continue;
    }
    members.push(member);
  }
  if (value.members.length > 0 && members.length === 0) return null;
  return hasDuplicateIdentity(members, (member) => member.userId) ? null : { members, signInTrackingEnabled };
}

function hasValidInvitationIdentity(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamInvitation, "id" | "role"> {
  return typeof row.id === "string" && row.id.length > 0 && isAccountRole(row.role) && row.role !== "owner";
}

function hasValidInvitationDates(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamInvitation, "expiresAt" | "usedAt" | "createdAt"> {
  return isTimestamp(row.expiresAt) && (row.usedAt === null || isTimestamp(row.usedAt)) && isTimestamp(row.createdAt);
}

function parseInvitation(row: unknown): TeamInvitation | null {
  if (!isRecord(row)) return null;
  if (!hasValidInvitationIdentity(row)) return null;
  if (!hasValidInvitationDates(row)) return null;
  if (!(row.preauthEmail === undefined || row.preauthEmail === null || typeof row.preauthEmail === "string"))
    return null;
  if (
    row.proposedResourceId !== undefined &&
    (typeof row.proposedResourceId !== "string" || row.proposedResourceId.length === 0)
  )
    return null;
  return {
    id: row.id,
    role: row.role,
    preauthEmail: typeof row.preauthEmail === "string" ? row.preauthEmail : null,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
    ...(typeof row.proposedResourceId === "string" ? { proposedResourceId: row.proposedResourceId } : {}),
  };
}

function parseInvitations(value: unknown): TeamInvitation[] | null {
  if (!isRecord(value) || !Array.isArray(value.invites)) return null;
  const invitations: TeamInvitation[] = [];
  for (const row of value.invites) {
    const invitation = parseInvitation(row);
    if (invitation === null) {
      console.warn("teamAccessClient: dropped an unsupported invitation-directory row", row);
      continue;
    }
    invitations.push(invitation);
  }
  if (value.invites.length > 0 && invitations.length === 0) return null;
  return hasDuplicateIdentity(invitations, (invitation) => invitation.id) ? null : invitations;
}

function hasUnsafeTokenCharacter(token: string): boolean {
  return Array.from(token).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return /\s/u.test(character) || codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function hasValidOptionalTokenFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & Pick<OneTimeToken, "id" | "expiresAt"> {
  const hasValidId = value.id === undefined || (typeof value.id === "string" && value.id.length > 0);
  const hasValidExpiry = value.expiresAt === undefined || isTimestamp(value.expiresAt);
  return hasValidId && hasValidExpiry;
}

function parseToken(value: unknown): OneTimeToken | null {
  if (!isRecord(value) || typeof value.token !== "string") return null;
  // Both current issuers return compact opaque strings. Keep the provider-owned alphabet opaque,
  // but reject values that cannot safely form one write-once URL segment or indicate a skewed body.
  if (value.token.length === 0 || value.token.length > 4_096) return null;
  if (value.token !== value.token.trim() || hasUnsafeTokenCharacter(value.token)) {
    return null;
  }
  if (!hasValidOptionalTokenFields(value)) return null;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    token: value.token,
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
  };
}

/** The decoder for an endpoint whose success carries no body: there is nothing to read, and the ok
 *  response itself is the whole answer. */
const noContent = (): true => true;

/** Typed account-administration boundary. Raw Response handling and untrusted payload codecs stay
 * here; the Team & access controller consumes semantic outcomes only. */
export const teamAccessClient = {
  ...ownershipTransferAccess,

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
    return readCommandResult(
      await accountClient.changeMemberRole({ workspaceId: workspaceId, principalId: principalId, role: role }),
      noContent,
    );
  },

  async changeMemberStatus(
    workspaceId: string,
    principalId: string,
    status: MembershipStatus,
  ): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.changeMemberStatus({ workspaceId: workspaceId, principalId: principalId, status: status }),
      noContent,
    );
  },

  async removeMember(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.removeMember(workspaceId, principalId), noContent);
  },

  async setMemberResourceLink(input: {
    workspaceId: string;
    principalId: string;
    resourceId: string;
    expectedRevision: string | null;
  }) {
    return readResult(await accountClient.setMemberResourceLink(input), (body) =>
      isRecord(body) && typeof body.resourceId === "string" && typeof body.revision === "string"
        ? { resourceId: body.resourceId, revision: body.revision }
        : null,
    );
  },

  async clearMemberResourceLink(workspaceId: string, principalId: string, expectedRevision: string) {
    return readCommandResult(
      await accountClient.clearMemberResourceLink({ workspaceId, principalId, expectedRevision }),
      noContent,
      204,
    );
  },

  async dismissMemberResourceLinkException(workspaceId: string, principalId: string) {
    return readCommandResult(
      await accountClient.dismissMemberResourceLinkException(workspaceId, principalId),
      noContent,
      204,
    );
  },

  async issuePasswordReset(workspaceId: string, principalId: string): Promise<TeamAccessResult<OneTimeToken>> {
    return readCommandResult(await accountClient.issuePasswordReset(workspaceId, principalId), parseToken, 201);
  },

  async revokeMemberSessions(workspaceId: string, principalId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.revokeMemberSessions(workspaceId, principalId), noContent, 204);
  },

  async createInvitation(input: {
    accountId: string;
    role: InvitationRole;
    preauthEmail?: string;
    proposedResourceId?: string;
  }): Promise<TeamAccessResult<OneTimeToken>> {
    return readCommandResult(await accountClient.createInvitation(input), parseToken, 201);
  },

  async revokeInvitation(workspaceId: string, invitationId: string): Promise<TeamAccessResult<true>> {
    return readCommandResult(await accountClient.revokeInvitation(workspaceId, invitationId), noContent);
  },
};
