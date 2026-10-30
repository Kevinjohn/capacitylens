import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { readMemberSignInTracking } from '#services/membership/sign_in_tracking';
import {
  readMemberResourceFields,
  readResourceCandidates,
} from '#services/member_resources/directory';

/** Builds the member directory after the caller authorizes company member management. */
export async function readMemberDirectory(
  trx: TransactionClientContract,
  accountId: string,
  actorId: string
) {
  const [rows, restrictions, tracking, resourceCandidates] = await Promise.all([
    trx
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
      .orderBy('member.created_at', 'asc'),
    trx
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
      .orderBy('restriction.principal_id', 'asc'),
    readMemberSignInTracking(accountId, trx),
    readResourceCandidates(trx, accountId),
  ]);
  const denied = new Set(restrictions.map((row) => String(row.principal_id)));
  const memberIds = new Set(rows.map((row) => String(row.user_id)));
  const resourceFields = await readMemberResourceFields(trx, accountId, [...memberIds]);
  const members = [];
  for (const row of rows) {
    const userId = String(row.user_id);
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
      ...resourceFields.get(userId),
    });
  }
  for (const row of restrictions) {
    const userId = String(row.principal_id);
    if (memberIds.has(userId)) continue;
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
