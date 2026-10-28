// Account administration decodes untrusted responses here so Team and access controllers consume semantic outcomes.
import type { InvitationRole, MembershipStatus } from '@capacitylens/shared/account/types';
import { isAccountRole, isMembershipStatus } from '@capacitylens/shared/account/types';
import type { Role } from '@capacitylens/shared/domain/access';
import { accountClient } from './accountClient';
import type { AdmissionStatus } from './accountClient';
import { hasDuplicateIdentity } from '@/lib/hasDuplicateIdentity';
import { isNullableString, isTimestamp, readCommandResult, readResult } from './accessResult';
import type { TeamAccessResult } from './accessResult';
import { ownershipTransferAccess } from './ownershipTransferAccess';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import type {
  TeamMember,
  TeamDirectory,
  TeamInvitation,
  AdmissionRequest,
} from './teamAccessTypes';

export { resolveRejectionMessage, type TeamAccessResult } from './accessResult';
export type {
  TeamMember,
  TeamDirectory,
  TeamInvitation,
  AdmissionRequest,
} from './teamAccessTypes';
export type { OwnershipTransferReceipt } from './ownershipTransferAccess';

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === 'boolean';

const isOptionalNullableBoolean = (value: unknown): value is boolean | null | undefined =>
  value === undefined || value === null || typeof value === 'boolean';

function hasValidMemberIdentity(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamMember, 'userId' | 'role' | 'status' | 'createdAt'> {
  return (
    typeof row.userId === 'string' &&
    row.userId.length > 0 &&
    isAccountRole(row.role) &&
    isMembershipStatus(row.status) &&
    isTimestamp(row.createdAt)
  );
}

function hasValidMemberAccess(
  row: Record<string, unknown>,
): row is Record<string, unknown> & Pick<TeamMember, 'isSelf'> {
  return (
    typeof row.isSelf === 'boolean' &&
    isOptionalNullableBoolean(row.signInConfirmed) &&
    isOptionalBoolean(row.accessDisabled) &&
    isOptionalBoolean(row.membershipPresent)
  );
}

function parseMember(row: unknown): TeamMember | null {
  if (!isRecord(row)) return null;
  if (!hasValidMemberIdentity(row)) return null;
  if (!hasValidMemberAccess(row)) return null;
  if (!isNullableString(row.name) || !isNullableString(row.email)) return null;
  const resourceLink = parseMemberResourceLink(row.resourceLink);
  if (resourceLink === undefined) return null;
  return {
    userId: row.userId,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    name: row.name,
    email: row.email,
    signInConfirmed: typeof row.signInConfirmed === 'boolean' ? row.signInConfirmed : null,
    isSelf: row.isSelf,
    accessDisabled: row.accessDisabled === true,
    membershipPresent: row.membershipPresent !== false,
    resourceLink,
  };
}

function parseMemberResourceStatus(
  value: unknown,
): 'active' | 'disabled' | 'archived' | null | undefined {
  if (value === undefined || value === null) return null;
  if (value === 'active' || value === 'disabled' || value === 'archived') return value;
  return undefined;
}

function parseMemberResourceLink(value: unknown): TeamMember['resourceLink'] | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.resourceId !== 'string' || value.resourceId.length === 0)
    return undefined;
  if (typeof value.revision !== 'string' || value.revision.length === 0) return undefined;
  if (
    value.resourceName !== undefined &&
    value.resourceName !== null &&
    typeof value.resourceName !== 'string'
  )
    return undefined;
  const resourceStatus = parseMemberResourceStatus(value.resourceStatus);
  if (resourceStatus === undefined) return undefined;
  return {
    resourceId: value.resourceId,
    revision: value.revision,
    resourceName: typeof value.resourceName === 'string' ? value.resourceName : null,
    resourceStatus,
  };
}

function parseResourceCandidate(value: unknown): { resourceId: string; label: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value.resourceId !== 'string' || value.resourceId.length === 0) return null;
  if (typeof value.label !== 'string' || value.label.length === 0) return null;
  return { resourceId: value.resourceId, label: value.label };
}

function parseDirectoryMembers(rows: readonly unknown[]): TeamMember[] | null {
  const members: TeamMember[] = [];
  for (const row of rows) {
    const member = parseMember(row);
    if (member === null) {
      console.warn('teamAccessClient: dropped an unsupported member-directory row');
      continue;
    }
    members.push(member);
  }
  return rows.length > 0 && members.length === 0 ? null : members;
}

function parseResourceCandidates(
  rows: readonly unknown[],
): { resourceId: string; label: string }[] {
  return rows.flatMap((candidate) => {
    const parsed = parseResourceCandidate(candidate);
    return parsed === null ? [] : [parsed];
  });
}

function parseMembers(value: unknown): TeamDirectory | null {
  if (!isRecord(value) || !Array.isArray(value.members)) return null;
  if (value.signInTrackingEnabled !== undefined && typeof value.signInTrackingEnabled !== 'boolean')
    return null;
  if (value.resourceCandidates !== undefined && !Array.isArray(value.resourceCandidates))
    return null;
  const signInTrackingEnabled = value.signInTrackingEnabled === true;
  const members = parseDirectoryMembers(value.members);
  if (members === null) return null;
  const resourceCandidates = parseResourceCandidates(value.resourceCandidates ?? []);
  return hasDuplicateIdentity(members, (member) => member.userId) ||
    hasDuplicateIdentity(resourceCandidates, (candidate) => candidate.resourceId)
    ? null
    : { members, signInTrackingEnabled, resourceCandidates };
}

function parseInvitation(row: unknown): TeamInvitation | null {
  if (!isRecord(row)) return null;
  const id =
    typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0
      ? String(row.id)
      : null;
  if (id === null || !isAccountRole(row.role) || row.role === 'owner') return null;
  if (
    typeof row.preauthEmail !== 'string' ||
    !isTimestamp(row.expiresAt) ||
    !isTimestamp(row.createdAt)
  )
    return null;
  return {
    id,
    role: row.role,
    preauthEmail: row.preauthEmail,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function parseInvitations(value: unknown): TeamInvitation[] | null {
  if (!isRecord(value) || !Array.isArray(value.invites)) return null;
  const invitations: TeamInvitation[] = [];
  for (const row of value.invites) {
    const invitation = parseInvitation(row);
    if (invitation === null) {
      console.warn('teamAccessClient: dropped an unsupported invitation-directory row');
      continue;
    }
    invitations.push(invitation);
  }
  if (value.invites.length > 0 && invitations.length === 0) return null;
  return hasDuplicateIdentity(invitations, (invitation) => invitation.id) ? null : invitations;
}

const noContent = (): true => true;

/** Whether the server's mail transport accepted the invitation email. */
function parseDelivery(value: unknown): { emailed: boolean } | null {
  return isRecord(value) && typeof value.emailed === 'boolean' ? { emailed: value.emailed } : null;
}

type AdmissionPage = { requests: AdmissionRequest[]; nextCursor: string | null };

function parseAdmissionPage(status: AdmissionStatus) {
  return (value: unknown): AdmissionPage | null => {
    if (
      !isRecord(value) ||
      !Array.isArray(value.items) ||
      !isNullableString(value.nextCursor ?? null)
    )
      return null;
    const requests = value.items.flatMap((item: unknown) => {
      if (!isRecord(item) || (typeof item.userId !== 'string' && typeof item.userId !== 'number'))
        return [];
      if (typeof item.email !== 'string' || !isNullableString(item.requestedAt)) return [];
      const invitation = isRecord(item.invitation) ? item.invitation : null;
      const role = invitation && typeof invitation.role === 'string' ? invitation.role : null;
      return [
        {
          userId: String(item.userId),
          email: item.email,
          requestedAt: item.requestedAt,
          invitedRole: role,
          approval: status,
        },
      ];
    });
    return { requests, nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null };
  };
}

type SetMemberSignInTrackingOptions = { workspaceId: string; enabled: boolean };
/** Provides typed request methods for team and access administration. */
export const teamAccessClient = {
  ...ownershipTransferAccess,

  async listMembers(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<TeamAccessResult<TeamDirectory>> {
    return readResult(await accountClient.listMembers(workspaceId, signal), parseMembers);
  },

  async setMemberSignInTracking({
    workspaceId,
    enabled,
  }: SetMemberSignInTrackingOptions): Promise<TeamAccessResult<boolean>> {
    return readResult(
      await accountClient.setMemberSignInTracking({ workspaceId, enabled }),
      (body) => (isRecord(body) && typeof body.enabled === 'boolean' ? body.enabled : null),
    );
  },

  async listInvitations(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<TeamAccessResult<TeamInvitation[]>> {
    return readResult(await accountClient.listInvitations(workspaceId, signal), parseInvitations);
  },

  async changeMemberRole(
    workspaceId: string,
    principalId: string,
    role: Role,
  ): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.changeMemberRole({
        workspaceId: workspaceId,
        principalId: principalId,
        role: role,
      }),
      noContent,
    );
  },

  async changeMemberStatus(
    workspaceId: string,
    principalId: string,
    status: MembershipStatus,
  ): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.changeMemberStatus({
        workspaceId: workspaceId,
        principalId: principalId,
        status: status,
      }),
      noContent,
    );
  },

  async enableMemberAccess(
    workspaceId: string,
    principalId: string,
  ): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.enableMemberAccess(workspaceId, principalId),
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
    return readCommandResult(await accountClient.setMemberResourceLink(input), (body) =>
      isRecord(body) && typeof body.resourceId === 'string' && typeof body.revision === 'string'
        ? { resourceId: body.resourceId, revision: body.revision }
        : null,
    );
  },

  async clearMemberResourceLink(
    workspaceId: string,
    principalId: string,
    expectedRevision: string,
  ) {
    return readCommandResult(
      await accountClient.clearMemberResourceLink({ workspaceId, principalId, expectedRevision }),
      noContent,
      204,
    );
  },

  /** Emails a new invitation. A 202 means it was stored but the email could not be sent. */
  async createInvitation(input: {
    accountId: string;
    role: InvitationRole;
    email: string;
  }): Promise<TeamAccessResult<{ emailed: boolean }>> {
    const response = await accountClient.createInvitation(input);
    return readCommandResult(response, parseDelivery, response.status === 202 ? 202 : 201);
  },

  async resendInvitation(
    workspaceId: string,
    invitationId: string,
  ): Promise<TeamAccessResult<{ emailed: boolean }>> {
    return readResult(
      await accountClient.resendInvitation(workspaceId, invitationId),
      parseDelivery,
    );
  },

  /** Every pending, declined and revoked record, read page by page; pending people come first. */
  async listAdmissionRequests(signal?: AbortSignal): Promise<TeamAccessResult<AdmissionRequest[]>> {
    const requests: AdmissionRequest[] = [];
    for (const status of ['pending', 'rejected', 'revoked'] as const) {
      let cursor: string | null = null;
      do {
        const page: TeamAccessResult<AdmissionPage> = await readResult(
          await accountClient.listAdmissionRequests(status, cursor, signal),
          parseAdmissionPage(status),
        );
        if (page.kind !== 'ok') return page;
        requests.push(...page.value.requests);
        cursor = page.value.nextCursor;
      } while (cursor);
    }
    return { kind: 'ok', status: 200, value: requests };
  },

  async decideAdmission(
    userId: string,
    decision: 'approve' | 'reject',
  ): Promise<TeamAccessResult<true>> {
    return readResult(await accountClient.decideAdmission(userId, decision), noContent);
  },

  async revokeInvitation(
    workspaceId: string,
    invitationId: string,
  ): Promise<TeamAccessResult<true>> {
    return readCommandResult(
      await accountClient.revokeInvitation(workspaceId, invitationId),
      noContent,
    );
  },
};
