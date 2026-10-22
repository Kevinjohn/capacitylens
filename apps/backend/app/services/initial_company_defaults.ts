import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'
import { encodeRow } from '#services/state_repository'

/** Writes the complete first company inside the caller's transaction. */
export async function createInitialCompany(
  trx: TransactionClientContract,
  input: { name: string; ownerId: string; actorId: string | null }
) {
  const name = input.name
  const accountId = crypto.randomUUID()
  const now = new Date().toISOString()
  await trx.table('accounts').insert(
    encodeRow('accounts', {
      ...NULLABLE_FIELDS.accounts,
      id: accountId,
      name,
      color: FALLBACK_PRESET_COLOR,
      schedulingMode: 'days',
      weekStartsOn: 1,
      workingDays: [1, 2, 3, 4, 5],
      disciplinesEnabled: false,
      placeholdersEnabled: false,
      externalEnabled: false,
      inlineActivityCreateEnabled: false,
      createdAt: now,
      updatedAt: now,
    })
  )
  await trx
    .table('clients')
    .insert(
      encodeRow(
        'clients',
        buildInternalClient(accountId, now) as unknown as Record<string, unknown>
      )
    )
  await trx.table('memberships').insert({
    id: crypto.randomUUID(),
    account_id: accountId,
    user_id: input.ownerId,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  await trx.table('company_planning_revisions').insert({ account_id: accountId, revision: 1 })
  await trx.table('audit_entries').insert({
    id: crypto.randomUUID(),
    account_id: accountId,
    actor_id: input.actorId,
    action: 'company.initialized',
    entity: 'account',
    entity_id: accountId,
    details: JSON.stringify({ changedFields: ['company', 'owner'] }),
    created_at: now,
    updated_at: now,
  })

  return { accountId, ownerId: input.ownerId }
}
