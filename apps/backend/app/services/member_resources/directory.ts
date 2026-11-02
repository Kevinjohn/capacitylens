import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl';

/** Keeps retained or archived resources identifiable in the member directory. */
export interface MemberResourceLinkProjection {
  resourceId: string;
  revision: string;
  resourceName: string | null;
  resourceStatus: 'active' | 'archived';
}

/** Makes an absent link explicit for every selected member. */
export interface MemberResourceFields {
  resourceLink: MemberResourceLinkProjection | null;
}

/** Reads same-company person candidates for an administrator's member directory. */
export async function readResourceCandidates(trx: TransactionClientContract, accountId: string) {
  const rows = await trx
    .from('resources')
    .where({ account_id: accountId, kind: 'person' })
    .whereNull('archived_at')
    .whereNull('deleted_at')
    .select('id', 'name', 'role');
  return rows.map((row) => ({ resourceId: String(row.id), label: String(row.name ?? row.role) }));
}

/** Reads a selected set of same-company association fields, keyed by member ID. */
export async function readMemberResourceFields(
  trx: TransactionClientContract,
  accountId: string,
  userIds: string[]
) {
  if (userIds.length === 0) return new Map<string, MemberResourceFields>();
  const links = await trx
    .from('account_member_resources as link')
    .leftJoin('resources as resource', function () {
      this.on('resource.id', '=', 'link.resource_id').andOn(
        'resource.account_id',
        '=',
        'link.account_id'
      );
    })
    .where('link.account_id', accountId)
    .whereIn('link.user_id', userIds)
    .select(
      'link.user_id',
      'link.resource_id',
      'link.revision',
      'resource.name',
      'resource.archived_at',
      'resource.deleted_at'
    );
  const result = new Map<string, MemberResourceFields>();
  for (const userId of userIds) result.set(userId, { resourceLink: null });
  for (const link of links) {
    result.set(String(link.user_id), {
      resourceLink: {
        resourceId: String(link.resource_id),
        revision: String(link.revision),
        resourceName: link.name ?? null,
        resourceStatus: link.deleted_at || link.archived_at ? 'archived' : 'active',
      },
    });
  }
  return result;
}

/** Reads active member person avatars after the caller authorizes company read access. */
export async function readMemberAvatars(trx: TransactionClientContract, accountId: string) {
  const rows = await trx
    .from('account_member_resources as link')
    .innerJoin('resources as resource', function () {
      this.on('resource.id', '=', 'link.resource_id').andOn(
        'resource.account_id',
        '=',
        'link.account_id'
      );
    })
    .innerJoin('memberships as member', function () {
      this.on('member.user_id', '=', 'link.user_id').andOn(
        'member.account_id',
        '=',
        'link.account_id'
      );
    })
    .where('link.account_id', accountId)
    .where('member.status', 'active')
    .where('resource.kind', 'person')
    .whereNull('resource.archived_at')
    .whereNull('resource.deleted_at')
    .select('resource.id', 'resource.avatar_url');
  return {
    avatars: rows.flatMap((row) => {
      const imageUrl = parseResourceAvatarUrl(row.avatar_url);
      return imageUrl ? [{ resourceId: String(row.id), imageUrl }] : [];
    }),
  };
}
