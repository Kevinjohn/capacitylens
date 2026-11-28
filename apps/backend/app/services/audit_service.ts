import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/** The audit trail, written in the caller's transaction. */
export class AuditService {
  /** Records one audit entry in the caller's transaction; `now` defaults to the current time. */
  async writeAudit(
    trx: TransactionClientContract,
    input: {
      companyId: string
      actorId: string
      action: string
      entity: string
      entityId: string
      fields: string[]
    },
    now = new Date().toISOString()
  ) {
    await trx.table('audit_entries').insert({
      id: crypto.randomUUID(),
      company_id: input.companyId,
      actor_id: input.actorId,
      operation: input.action,
      entity: input.entity,
      entity_id: input.entityId,
      details: JSON.stringify({
        changedFields: input.fields,
      }),
      created_at: now,
      updated_at: now,
    })
  }
}
