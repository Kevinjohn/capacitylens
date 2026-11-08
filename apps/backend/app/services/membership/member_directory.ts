import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder';
import {
  isAccountRole,
  isMembershipStatus,
  type MembershipStatus,
  type Role,
} from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import type { MemberResourceLinkProjection } from '#services/member_resources/directory';
import { readMemberSignInTracking } from '#services/membership/sign_in_tracking';
import {
  type MemberResourceFields,
  readMemberResourceFields,
  readResourceCandidates,
} from '#services/member_resources/directory';

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
  accountId: string,
  actor: { actorId: string; role: Role }
): Promise<MemberDirectory> {
  const { actorId } = actor;
  const membershipQuery: DatabaseQueryBuilderContract<MembershipDirectoryRow> = trx
    .from(`${access.config.membershipsTable} as member`)
    .leftJoin('users as principal', 'principal.id', 'member.user_id')
    .where('member.scope_id', accountId)
    .select(
      'member.user_id',
      'member.role',
      'member.status',
      'member.created_at',
      'principal.display_name',
      'principal.email'
    )
    .orderBy('member.created_at', 'asc');
  const [rows, tracking, resourceCandidates] = await Promise.all([
    membershipQuery,
    readMemberSignInTracking(accountId, trx),
    readResourceCandidates(trx, accountId),
  ]);
  const memberIds = new Set(rows.map((row) => row.user_id));
  const resourceFields = await readMemberResourceFields(trx, accountId, [...memberIds]);
  const members: MemberDirectoryEntry[] = [];
  for (const row of rows) {
    const userId = row.user_id;
    if (!isAccountRole(row.role)) throw new Error('Membership has an invalid role.');
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
