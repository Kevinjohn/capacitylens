// Account administration decodes untrusted responses here so Team and access controllers consume semantic outcomes.
import type { InvitationRole, MembershipStatus } from '@capacitylens/shared/account/types';
import type { Role } from '@capacitylens/shared/domain/access';
import { accountClient } from './accountClient';
import { readCommandResult, readResult } from './accessResult';
import {
  parseAdmissionPage,
  parseDelivery,
  parseInvitations,
  parseMembers,
} from './teamAccessParsers';
import type { AdmissionPage } from './teamAccessParsers';
import type { TeamAccessResult } from './accessResult';
import { ownershipTransferAccess } from './ownershipTransferAccess';
import { isRecord } from '@capacitylens/shared/lib/isRecord';
import type { TeamDirectory, TeamInvitation, AdmissionRequest } from './teamAccessTypes';

export { resolveRejectionMessage, type TeamAccessResult } from './accessResult';
export type {
  TeamMember,
  TeamDirectory,
  TeamInvitation,
  AdmissionRequest,
} from './teamAccessTypes';
export type { OwnershipTransferReceipt } from './ownershipTransferAccess';

const noContent = (): true => true;

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
        // Cancellation can arrive during decoding; another cursor or status must not start.
        signal?.throwIfAborted();
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
