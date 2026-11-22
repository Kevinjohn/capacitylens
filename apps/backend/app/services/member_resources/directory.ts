import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import Resource from '#models/resource';

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

/** Reads same-company person candidates for an Owner's or Admin's member directory. */
export async function readResourceCandidates(trx: TransactionClientContract, companyId: string) {
  const rows = await Resource.query({ client: trx })
    .withScopes((scopes) => scopes.forCompany(companyId))
    .where('kind', 'person')
    .whereNull('archived_at')
    .whereNull('deleted_at')
    .select('id', 'name', 'job_title');
  return rows.map((row) => ({
    resourceId: String(row.id),
    label: String(row.name ?? row.jobTitle),
  }));
}

/** Reads a selected set of same-company association fields, keyed by member ID. */
export async function readMemberResourceFields(
  trx: TransactionClientContract,
  companyId: string,
  userIds: string[]
) {
  if (userIds.length === 0) return new Map<string, MemberResourceFields>();
  const links = await trx
    .from('account_member_resources as link')
    .leftJoin('resources as resource', function () {
      this.on('resource.id', '=', 'link.resource_id').andOn(
        'resource.company_id',
        '=',
        'link.company_id'
      );
    })
    .where('link.company_id', companyId)
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
