import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import access from '#config/access_control';

/** Creates the first membership and planning metadata inside the company graph transaction. */
export async function initializeCompanyAccess(
  trx: TransactionClientContract,
  input: { companyId: string; ownerId: string; actorId: string | null; now: string }
) {
  await access.memberships.createFirstMember({
    scopeId: input.companyId,
    userId: input.ownerId,
    trx,
  });
  await trx
    .table('company_planning_revisions')
    .insert({ company_id: input.companyId, revision: 1 });
  await trx.table('audit_entries').insert({
    id: crypto.randomUUID(),
    company_id: input.companyId,
    actor_id: input.actorId,
    action: 'company.initialized',
    entity: 'account',
    entity_id: input.companyId,
    details: JSON.stringify({ changedFields: ['company', 'owner'] }),
    created_at: input.now,
    updated_at: input.now,
  });
}
