import app from '@adonisjs/core/services/app';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder';
import {
  isRole,
  isMembershipStatus,
  type MembershipStatus,
  type Role,
} from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { readMemberSignInTracking } from '#services/membership/sign_in_tracking';
import {
  type MemberResourceFields,
  type MemberResourceLinkProjection,
  MemberResourceDirectoryService,
} from '#services/member_resources/member_resource_directory_service';

interface MembershipDirectoryRow {
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  display_name: string | null;
  email: string | null;
}

/** A member as returned by the company directory. */
export interface MemberDirectoryEntry {
  userId: string;
  role: Role;
  status: MembershipStatus;
  /** Whether the reader may change this member's role or status, as the package decides. */
  manage: boolean;
  createdAt: string;
  name: string | null;
  email: string | null;
  signInConfirmed: boolean | null;
  isSelf: boolean;
  resourceLink: MemberResourceLinkProjection | null;
}

interface MemberResourceCandidate {
  resourceId: string;
  label: string;
}

/** The full company-scoped membership directory response. */
export interface MemberDirectory {
  members: MemberDirectoryEntry[];
  signInTrackingEnabled: boolean;
  resourceCandidates: MemberResourceCandidate[];
}

/** Builds the member directory after the caller authorizes company member management. */
export async function readMemberDirectory(
  trx: TransactionClientContract,
  companyId: string,
  actor: { actorId: string; role: Role }
): Promise<MemberDirectory> {
  const { actorId } = actor;
  const membershipQuery: DatabaseQueryBuilderContract<MembershipDirectoryRow> = trx
    .from(`${access.config.membershipsTable} as member`)
    .leftJoin('users as member_user', 'member_user.id', 'member.user_id')
    .where('member.scope_id', companyId)
    .select(
      'member.user_id',
      'member.role',
      'member.status',
      'member.created_at',
      'member_user.display_name',
      'member_user.email'
    )
    .orderBy('member.created_at', 'asc');
  const memberResources = await app.container.make(MemberResourceDirectoryService);
  const [rows, tracking, resourceCandidates] = await Promise.all([
    membershipQuery,
    readMemberSignInTracking(companyId, trx),
    memberResources.readCandidates(trx, companyId),
  ]);
  const memberIds = new Set(rows.map((row) => row.user_id));
  const resourceFields = await memberResources.readMemberFields(trx, companyId, [...memberIds]);
  const members: MemberDirectoryEntry[] = [];
  for (const row of rows) {
    const userId = row.user_id;
    if (!isRole(row.role)) throw new Error('Membership has an invalid role.');
    if (!isMembershipStatus(row.status)) throw new Error('Membership has an invalid status.');
    // The lookup producer seeds every requested member ID before applying any links.
    const memberResourceFields = resourceFields.get(userId) as MemberResourceFields;
    members.push({
      userId,
      role: row.role,
      status: row.status,
      manage: access.canManage({
        actorRole: actor.role,
        targetRole: row.role,
        isSelf: actorId === userId,
      }).allowed,
      createdAt: row.created_at,
      name: row.display_name ?? null,
      email: row.email ?? null,
      signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
      isSelf: actorId === userId,
      ...memberResourceFields,
    });
  }
  return { members, signInTrackingEnabled: tracking.enabled, resourceCandidates };
}
