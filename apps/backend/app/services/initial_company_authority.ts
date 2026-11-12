import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import access from '#config/access_control';

/** Establishes authority and planning metadata inside the company graph transaction. */
export async function establishInitialCompanyAuthority(
  trx: TransactionClientContract,
  input: { accountId: string; ownerId: string; actorId: string | null; now: string }
) {
  await access.memberships.createFirstMember({
    scopeId: input.accountId,
    userId: input.ownerId,
    trx,
  });
  await trx
    .table('company_planning_revisions')
    .insert({ account_id: input.accountId, revision: 1 });
  await trx.table('audit_entries').insert({
    id: crypto.randomUUID(),
    account_id: input.accountId,
    actor_id: input.actorId,
    action: 'company.initialized',
    entity: 'account',
    entity_id: input.accountId,
    details: JSON.stringify({ changedFields: ['company', 'owner'] }),
    created_at: input.now,
    updated_at: input.now,
  });
}
