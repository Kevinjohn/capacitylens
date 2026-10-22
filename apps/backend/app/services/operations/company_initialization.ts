import { createInitialCompany } from '#services/initial_company_defaults'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { assertSchemaIntegrity } from '#services/schema_integrity'
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
      return createInitialCompany(trx, { name, ownerId: String(principal.id), actorId: null })
    })
  })
}
