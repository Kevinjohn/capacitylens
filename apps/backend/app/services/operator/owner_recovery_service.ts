import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import type { Trx } from '@kevinjohn/adonisjs-account-kit/types'
import access from '#config/access_control'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { operatorDatabasePath, withOperatorDatabase } from '@kevinjohn/adonisjs-sqlite-backup'
import { SchemaIntegrityService } from '#services/schema_integrity_service'
import User from '#models/user'

const ineligible = 'Recovery requires a sole active Owner with a local password'

/** Stopped-server recovery for a sole Owner who cannot sign in. */
@inject()
export class OwnerRecoveryService {
  #schemaIntegrity: SchemaIntegrityService

  constructor(schemaIntegrity: SchemaIntegrityService) {
    this.#schemaIntegrity = schemaIntegrity
  }

  async #requireSoleOwnerCompanyIds(userId: string, trx: Pick<Trx, 'from'>) {
    const memberships = await trx
      .from(access.config.membershipsTable)
      .where({ user_id: userId, role: 'owner', status: 'active' })
      .select('scope_id')
    const companyIds: string[] = []
    for (const membership of memberships) {
      const owners = await trx
        .from(access.config.membershipsTable)
        .where({ scope_id: membership.scope_id, role: 'owner', status: 'active' })
        .count('* as n')
        .first()
      if (Number(owners?.n) === 1) companyIds.push(String(membership.scope_id))
    }
    if (!companyIds.length) throw new Error(ineligible)
    return companyIds.sort()
  }

  /**
   * Prints an Account Kit reset link for a sole Owner while the server is stopped. The audit entry
   * is written after issuance; if it fails no link is shown, and the unseen link simply expires.
   */
  async recover(input: { email: string; confirmServerStopped: boolean }) {
    operatorDatabasePath(db, input.confirmServerStopped)
    const email = normalizeAccountEmail(input.email)
    if (!isAccountEmail(email)) throw new Error('The target is not a valid account address')
    return withOperatorDatabase(db, async () => {
      await this.#schemaIntegrity.assertSchemaIntegrity()
      const user = await User.query({ client: db.connection() })
        .where('email', email)
        .select('id', 'password')
        .first()
      if (!user?.password) throw new Error(ineligible)
      const userId = String(user.id)
      const companyIds = await this.#requireSoleOwnerCompanyIds(userId, db)
      const issued = await accountKit.operator.resetLink({ email, deliver: 'print' })
      if (!issued.url || String(issued.user.id) !== userId) {
        throw new Error('Owner recovery failed; no recovery link was delivered')
      }
      await db.transaction(async (trx) => {
        const now = new Date().toISOString()
        for (const companyId of companyIds) {
          await trx.table('audit_entries').insert({
            id: crypto.randomUUID(),
            company_id: companyId,
            actor_id: null,
            action: 'identity.owner_recovery_issued',
            entity: 'user',
            entity_id: userId,
            details: JSON.stringify({ changedFields: ['credential'] }),
            created_at: now,
            updated_at: now,
          })
        }
      })
      return { email, userId, companyIds, link: issued.url }
    })
  }
}
