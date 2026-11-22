// Account administration decodes untrusted responses here so Team and access controllers consume semantic outcomes.
import type { InvitationRole, MembershipStatus } from '@capacitylens/shared/account/types';
import type { Role } from '@capacitylens/shared/domain/access';
import { admissionRequests } from './admissionRequests';
import { invitationRequests } from './invitationRequests';
import { memberRequests } from './memberRequests';
import { readOperationResult, readResult } from './accessResult';
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

export { resolveRefusalMessage, type TeamAccessResult } from './accessResult';
export type {
  TeamMember,
  TeamDirectory,
  TeamInvitation,
  AdmissionRequest,
} from './teamAccessTypes';
export type { OwnershipTransferReceipt } from './ownershipTransferAccess';

const acceptNoContent = (): true => true;

type SetMemberSignInTrackingOptions = { companyId: string; enabled: boolean };
/** Provides typed request methods for team and access administration. */
export const teamAccessApi = {
  ...ownershipTransferAccess,

  async listMembers(
    companyId: string,
    signal?: AbortSignal,
  ): Promise<TeamAccessResult<TeamDirectory>> {
    return readResult(await memberRequests.listMembers(companyId, signal), parseMembers);
  },

  async setMemberSignInTracking({
    companyId,
    enabled,
  }: SetMemberSignInTrackingOptions): Promise<TeamAccessResult<boolean>> {
    return readResult(
      await memberRequests.setMemberSignInTracking({ companyId, enabled }),
      (body) => (isRecord(body) && typeof body.enabled === 'boolean' ? body.enabled : null),
    );
  },

  async listInvitations(
    companyId: string,
    signal?: AbortSignal,
  ): Promise<TeamAccessResult<TeamInvitation[]>> {
    return readResult(
      await invitationRequests.listInvitations(companyId, signal),
      parseInvitations,
    );
  },

  async changeMemberRole(
    companyId: string,
    userId: string,
    role: Role,
  ): Promise<TeamAccessResult<true>> {
    return readOperationResult(
      await memberRequests.changeMemberRole({ companyId, userId, role }),
      acceptNoContent,
    );
  },

  async changeMemberStatus(
    companyId: string,
    userId: string,
    status: MembershipStatus,
  ): Promise<TeamAccessResult<true>> {
    return readOperationResult(
      await memberRequests.changeMemberStatus({ companyId, userId, status }),
      acceptNoContent,
    );
  },

  async setMemberResourceLink(input: {
    companyId: string;
    userId: string;
    resourceId: string;
    expectedRevision: string | null;
  }) {
    return readOperationResult(await memberRequests.setMemberResourceLink(input), (body) =>
      isRecord(body) && typeof body.resourceId === 'string' && typeof body.revision === 'string'
        ? { resourceId: body.resourceId, revision: body.revision }
        : null,
    );
  },

  async clearMemberResourceLink(companyId: string, userId: string, expectedRevision: string) {
    return readOperationResult(
      await memberRequests.clearMemberResourceLink({ companyId, userId, expectedRevision }),
      acceptNoContent,
      204,
    );
  },

  /** Emails a new invitation. A 202 means it was stored but the email could not be sent. */
  async createInvitation(input: {
    companyId: string;
    role: InvitationRole;
    email: string;
  }): Promise<TeamAccessResult<{ emailed: boolean }>> {
    const response = await invitationRequests.createInvitation(input);
    return readOperationResult(response, parseDelivery, response.status === 202 ? 202 : 201);
  },

  async resendInvitation(
    companyId: string,
    invitationId: string,
  ): Promise<TeamAccessResult<{ emailed: boolean }>> {
    return readResult(
      await invitationRequests.resendInvitation(companyId, invitationId),
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
          await admissionRequests.listAdmissionRequests(status, cursor, signal),
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
    return readResult(await admissionRequests.decideAdmission(userId, decision), acceptNoContent);
  },

  async revokeInvitation(companyId: string, invitationId: string): Promise<TeamAccessResult<true>> {
    return readOperationResult(
      await invitationRequests.revokeInvitation(companyId, invitationId),
      acceptNoContent,
    );
  },
};
