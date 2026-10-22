import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import { encodeRow } from '#services/state_repository'
import { withTransaction } from '#services/with_transaction'
import { googleEnabled, passwordEnabled } from '#services/auth/mode'
import { operatorDatabasePath, withOperatorDatabase } from './operator_database.js'

/** Establish the first company role for an existing native identity without changing admission. */
export async function initializeCompany(input: {
  email: string
  companyName: string
  confirmServerStopped: boolean
}) {
  operatorDatabasePath(input.confirmServerStopped)
  const email = normalizeAccountEmail(input.email)
  const name = input.companyName.trim()
  if (!isAccountEmail(email) || !name || name.length > 200)
    throw new Error('Refusing invalid email or company name')
  return withOperatorDatabase(async () => {
    await assertSchemaIntegrity()
    return withTransaction(async (trx) => {
      if ((await trx.from('accounts').first()) || (await trx.from('memberships').first()))
        throw new Error('Refusing company initialization: installation already has company access')
      const users = await trx.from('users').select('id', 'email', 'password_hash')
      const principals = users.filter((row) => normalizeAccountEmail(String(row.email)) === email)
      if (principals.length !== 1)
        throw new Error(
          'Refusing company initialization: an unambiguous existing identity is required'
        )
      const principal = principals[0]!
      const password =
        passwordEnabled() &&
        typeof principal.password_hash === 'string' &&
        principal.password_hash.length > 0
      const google =
        googleEnabled() &&
        (await trx
          .from('provider_identities')
          .where({
            user_id: String(principal.id),
            provider: 'google',
            issuer: 'https://accounts.google.com',
          })
          .whereNotNull('subject')
          .whereNot('subject', '')
          .first())
      if (!password && !google)
        throw new Error('Refusing company initialization: identity has no enabled sign-in method')
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
        user_id: principal.id,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      // Owner authority burns any reset bearer issued before the identity held a company role,
      // as every other access-granting path does.
      await trx.from('password_reset_tokens').where('tokenable_id', String(principal.id)).delete()
      await trx.table('company_planning_revisions').insert({ account_id: accountId, revision: 1 })
      // Stopped-server authority is the operator, rather than an impersonated signed-in principal.
      await trx.table('audit_entries').insert({
        id: crypto.randomUUID(),
        account_id: accountId,
        actor_id: null,
        action: 'company.initialized',
        entity: 'account',
        entity_id: accountId,
        details: JSON.stringify({ changedFields: ['company', 'owner'] }),
        created_at: now,
        updated_at: now,
      })
      return { accountId, ownerId: String(principal.id) }
    })
  })
}
