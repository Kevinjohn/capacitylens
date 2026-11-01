import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder';
import {
  isAccountRole,
  isMembershipStatus,
  type MembershipStatus,
  type Role,
} from '@capacitylens/shared/account/types';
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

interface RestrictedPrincipalDirectoryRow {
  principal_id: string;
  role: string;
  verified_email: string | null;
  created_at: string;
  display_name: string | null;
  email: string | null;
}

/** A member or retained access restriction as returned by the company directory. */
export interface MemberDirectoryEntry {
  userId: string;
  role: Role;
  status: MembershipStatus;
  accessDisabled: boolean;
  membershipPresent: boolean;
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
  actorId: string
): Promise<MemberDirectory> {
  const membershipQuery: DatabaseQueryBuilderContract<MembershipDirectoryRow> = trx
    .from('memberships as member')
    .leftJoin('users as principal', 'principal.id', 'member.user_id')
    .where('member.account_id', accountId)
    .select(
      'member.user_id',
      'member.role',
      'member.status',
      'member.created_at',
      'principal.display_name',
      'principal.email'
    )
    .orderBy('member.created_at', 'asc');
  const restrictionQuery: DatabaseQueryBuilderContract<RestrictedPrincipalDirectoryRow> = trx
    .from('account_access_restrictions as restriction')
    .leftJoin('users as principal', 'principal.id', 'restriction.principal_id')
    .where('restriction.account_id', accountId)
    .select(
      'restriction.principal_id',
      'restriction.role',
      'restriction.verified_email',
      'restriction.created_at',
      'principal.display_name',
      'principal.email'
    )
    .orderBy('restriction.created_at', 'asc')
    .orderBy('restriction.principal_id', 'asc');
  const [rows, restrictions, tracking, resourceCandidates] = await Promise.all([
    membershipQuery,
    restrictionQuery,
    readMemberSignInTracking(accountId, trx),
    readResourceCandidates(trx, accountId),
  ]);
  const denied = new Set(restrictions.map((row) => row.principal_id));
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
      accessDisabled: denied.has(userId),
      membershipPresent: true,
      createdAt: row.created_at,
      name: row.display_name ?? null,
      email: row.email ?? null,
      signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
      isSelf: actorId === userId,
      ...memberResourceFields,
    });
  }
  for (const row of restrictions) {
    const userId = row.principal_id;
    if (memberIds.has(userId)) continue;
    if (!isAccountRole(row.role)) throw new Error('Access restriction has an invalid role.');
    members.push({
      userId,
      role: row.role,
      status: 'disabled',
      accessDisabled: true,
      membershipPresent: false,
      createdAt: row.created_at,
      name: row.display_name ?? null,
      email: row.email ?? row.verified_email ?? null,
      signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
      isSelf: actorId === userId,
      resourceLink: null,
    });
  }
  return { members, signInTrackingEnabled: tracking.enabled, resourceCandidates };
}
