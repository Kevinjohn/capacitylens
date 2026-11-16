import type { TransactionClientContract } from '@adonisjs/lucid/types/database';

/** Records one audit entry in the caller's transaction; `now` defaults to the current time. */
export async function writeAudit(
  trx: TransactionClientContract,
  input: {
    accountId: string;
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    fields: string[];
  },
  now = new Date().toISOString()
) {
  await trx.table('audit_entries').insert({
    id: crypto.randomUUID(),
    account_id: input.accountId,
    actor_id: input.actorId,
    action: input.action,
    entity: input.entity,
    entity_id: input.entityId,
    details: JSON.stringify({
      changedFields: input.fields,
    }),
    created_at: now,
    updated_at: now,
  });
}
