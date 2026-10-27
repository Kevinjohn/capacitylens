import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import accountKit from 'adonisjs-account-kit/services/main'
import { defineConfig } from 'adonisjs-masquerade'
import { accountKitAuthority } from 'adonisjs-masquerade/account-kit'
import { LucidControlStore } from 'adonisjs-masquerade/stores/lucid'
import { accountInput } from '#services/auth/current_actor'
import { sessionUsers } from '#config/auth'
import { activeCompanyRole } from '#services/auth/authorization'
import { can } from '@capacitylens/shared/domain/access'
import type User from '#models/user'

type MasqueradeUser = User

/** The package checks Account Kit credentials and current memberships on every admission. */
export const nativeAdapter = accountKitAuthority<MasqueradeUser>({
  namespace: 'capacitylens',
  incarnation: 'id',
  provider: sessionUsers,
  kit: () => accountKit,
  managedGuard: {
    name: 'web',
    strategy: 'session',
    current: accountInput,
  },
})

function requestedAccountId(request?: HttpContext): string | null {
  if (!request) return null
  const value = request.params.accountId
  return typeof value === 'string' && value ? value : null
}

export default defineConfig<MasqueradeUser, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    async canMasquerade({ actor, target, request }) {
      const accountId = requestedAccountId(request)
      if (accountId) {
        const actorRole = await activeCompanyRole(actor.id, accountId, db)
        const targetRole = await activeCompanyRole(target.id, accountId, db)
        return Boolean(
          actorRole && can(actorRole, 'masquerade') && targetRole && actor.id !== target.id
        )
      }
      const roles = await db
        .from('memberships')
        .where({ user_id: actor.id, status: 'active' })
        .select('account_id')
      for (const row of roles) {
        const memberAccountId = String(row.account_id)
        const role = await activeCompanyRole(actor.id, memberAccountId, db)
        const targetRole = await activeCompanyRole(target.id, memberAccountId, db)
        if (role && can(role, 'masquerade') && targetRole) return actor.id !== target.id
      }
      return false
    },
    async canUseRequest({ actor, target, request }) {
      const accountId = requestedAccountId(request)
      if (accountId) {
        const actorRole = await activeCompanyRole(actor.id, accountId, db)
        const targetRole = await activeCompanyRole(target.id, accountId, db)
        return Boolean(actorRole && can(actorRole, 'masquerade') && targetRole)
      }
      const memberships = await db
        .from('memberships')
        .where({ user_id: actor.id, status: 'active' })
        .select('account_id')
      for (const row of memberships) {
        const memberAccountId = String(row.account_id)
        const actorRole = await activeCompanyRole(actor.id, memberAccountId, db)
        const targetRole = await activeCompanyRole(target.id, memberAccountId, db)
        if (actorRole && can(actorRole, 'masquerade') && targetRole) return true
      }
      return false
    },
  },
  store: async () => new LucidControlStore(db.connection()),
  durationSeconds: 900,
  maxDurationSeconds: 900,
  contextEnforcement: 'enforce',
  retention: 'host-managed',
})
