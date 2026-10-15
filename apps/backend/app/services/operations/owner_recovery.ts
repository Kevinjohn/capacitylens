import { createHash } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import encryption from '@adonisjs/core/services/encryption'
import limiter from '@adonisjs/limiter/services/main'
import { AccountKit, defineConfig } from 'adonisjs-account-kit'
import type { Trx } from 'adonisjs-account-kit/types'
import { PostCommitError } from 'adonisjs-account-kit/errors'
import env from '#start/env'
import { usersAdapter } from '#services/account_kit/users_adapter'
import { assertReleasedMigrations } from '#services/released_migrations'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { operatorDatabasePath, withOperatorDatabase } from './operator_database.js'

async function soleOwnerAccounts(userId: string, trx: Trx) {
  const memberships = await trx
    .from('memberships')
    .where({ user_id: userId, role: 'owner', status: 'active' })
    .select('account_id')
  if (!memberships.length)
    throw new Error('Recovery requires a sole active Owner with a local password')
  const accounts: string[] = []
  for (const membership of memberships) {
    const owners = await trx
      .from('memberships')
      .where({ account_id: membership.account_id, role: 'owner', status: 'active' })
      .count('* as n')
      .first()
    if (Number(owners?.n) === 1) accounts.push(String(membership.account_id))
  }
  if (!accounts.length)
    throw new Error('Recovery requires a sole active Owner with a local password')
  return accounts.sort()
}

/** Issue the ordinary recovery ceremony, with authority and private audit in its transaction. */
export async function recoverOwner(input: { email: string; confirmServerStopped: boolean }) {
  operatorDatabasePath(input.confirmServerStopped)
  const email = normalizeAccountEmail(input.email)
  if (!isAccountEmail(email)) throw new Error('The target is not a valid account address')
  if (!['password-only', 'password-and-sso'].includes(env.get('CAPACITYLENS_MODE') || 'off'))
    throw new Error('CAPACITYLENS_MODE must be password-only or password-and-sso')
  const origin = env.get('CAPACITYLENS_PUBLIC_URL')
  if (!origin) throw new Error('CAPACITYLENS_PUBLIC_URL is required')
  return withOperatorDatabase(async () => {
    await assertReleasedMigrations()
    await assertSchemaIntegrity()
    const identities = await db.from('users').select('id', 'email')
    const matches = identities.filter((row) => normalizeAccountEmail(String(row.email)) === email)
    if (matches.length !== 1)
      throw new Error('Recovery requires an unambiguous sole active Owner with a local password')
    const user = await usersAdapter.findByEmail(email)
    if (!user?.hasPassword)
      throw new Error('Recovery requires a sole active Owner with a local password')
    let token: string | undefined
    let expiresAt: string | undefined
    let accountIds: string[] = []
    let ceremonyId: string | undefined
    const config = defineConfig({
      users: usersAdapter,
      usersTable: 'users',
      enabled: ['recovery'],
      limiterSecret: env.get('CAPACITYLENS_SECRET') || env.get('APP_KEY').release(),
      limiterNamespace: 'capacitylens:operator-recovery:v1',
      ttl: { recovery: '24h' },
      urls: {
        recovery(value) {
          token = value
          return new URL(`/reset-password/${encodeURIComponent(value)}`, origin).href
        },
      },
      notify: {
        async recovery() {
          /* The operator receives the captured link directly. */
        },
        async passwordReset() {
          throw new Error('Operator issuance does not redeem credentials')
        },
      },
      async onRecoveryIssuedTransaction(current, trx) {
        if (String(current.id) !== String(user.id) || !current.hasPassword)
          throw new Error('Recovery requires a sole active Owner with a local password')
        accountIds = await soleOwnerAccounts(String(current.id), trx)
        const row = await trx
          .from('account_recovery_tokens')
          .where('user_id', String(current.id))
          .first()
        if (!row) throw new Error('Recovery ceremony was not recorded')
        expiresAt = String(row.expires_at)
        ceremonyId = String(row.token_hash)
        const now = new Date().toISOString()
        for (const accountId of accountIds)
          await trx.table('audit_entries').insert({
            id: crypto.randomUUID(),
            account_id: accountId,
            actor_id: null,
            action: 'identity.owner_recovery_issued',
            entity: 'user',
            entity_id: String(current.id),
            details: JSON.stringify({ changedFields: ['credential', `ceremony:${ceremonyId}`] }),
            created_at: now,
            updated_at: now,
          })
      },
    })
    const kit = new AccountKit({ config, db, encryption: encryption.use(), limiter })
    try {
      await kit.recovery.request({ email, clientKey: 'stopped-server-operator' })
    } catch (error) {
      // A bearer is only exposed after the package's post-commit URL callback proves issuance.
      if (!(error instanceof PostCommitError) || !token) throw error
    }
    if (!token || !expiresAt || !ceremonyId) throw new Error('Recovery ceremony was not issued')
    if (createHash('sha256').update(token).digest('hex') !== ceremonyId)
      throw new Error('Recovery ceremony identity could not be verified')
    return {
      email,
      userId: String(user.id),
      accountIds,
      ceremonyId,
      expiresAt,
      link: new URL(`/reset-password/${encodeURIComponent(token)}`, origin).href,
    }
  })
}
