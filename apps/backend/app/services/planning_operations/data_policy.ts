import { Bouncer } from '@adonisjs/bouncer'
import DataPolicy from '#policies/data_policy'
import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { can, canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access'
import type { Role } from '@capacitylens/shared/account/types'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { restrictedCompanyIds } from '#services/auth/authorization'
import { effectiveReadPrincipal } from '#services/auth/masquerade'

export interface BatchCapabilities {
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  canWrite: boolean
  canAnonymise: boolean
  canSeePrivateNames: boolean
  canSeeTimeOffNote: boolean
}

export interface BatchDataContext extends BatchCapabilities {
  actorId: string
  logCommitted: (event: { applied: number; changed: number }) => void | Promise<void>
  capabilitiesFor: (accountId: string) => BatchCapabilities
  authorize: (
    accountId: string,
    action: 'write' | 'anonymise',
    capabilities: BatchCapabilities
  ) => Promise<boolean>
}

/** Provides owner capabilities for the authenticated first-company creation transaction. */
export function initialCompanyDataContext(
  actorId: string,
  logCommitted: BatchDataContext['logCommitted'] = () => {}
): BatchDataContext {
  const capabilities = {
    role: 'owner' as const,
    canWrite: true,
    canAnonymise: true,
    canSeePrivateNames: true,
    canSeeTimeOffNote: true,
  }
  const bouncer = new Bouncer({ id: actorId })
  return {
    actorId,
    ...capabilities,
    logCommitted,
    capabilitiesFor: () => capabilities,
    authorize: (accountId, action, resolved) =>
      bouncer.with(DataPolicy).allows(action, { accountId, capabilities: resolved }),
  }
}

/** Builds role capabilities from transaction-current active memberships for signed-in data writes. */
export async function dataContextForActor(
  ctx: HttpContext,
  trx: TransactionClientContract,
  logCommitted: BatchDataContext['logCommitted'] = () => {}
): Promise<BatchDataContext> {
  const actor = await resolveCurrentActor(ctx, trx)
  const principal = await effectiveReadPrincipal(ctx, trx)
  const rows = await trx
    .from('memberships')
    .where({ user_id: principal.effectiveId, status: 'active' })
    .select('account_id', 'role')
  const restricted = await restrictedCompanyIds(principal.effectiveId, trx)
  const roles = new Map<string, Role>()
  for (const row of rows) {
    if (
      !restricted.has(String(row.account_id)) &&
      (principal.accountId === null || principal.accountId === String(row.account_id)) &&
      (row.role === 'owner' ||
        row.role === 'admin' ||
        row.role === 'editor' ||
        row.role === 'viewer')
    )
      roles.set(String(row.account_id), row.role)
  }
  const capabilitiesFor = (accountId: string): BatchCapabilities => {
    const role = roles.get(accountId) ?? 'viewer'
    return {
      role,
      canWrite: roles.has(accountId) && can(role, 'write'),
      canAnonymise: roles.has(accountId) && can(role, 'anonymise'),
      canSeePrivateNames: roles.has(accountId) && canSeePrivateNames(role),
      canSeeTimeOffNote: roles.has(accountId) && canSeeTimeOffNote(role),
    }
  }
  const bouncer = new Bouncer({ id: actor.userId })
  return {
    actorId: actor.userId,
    ...capabilitiesFor(''),
    capabilitiesFor,
    logCommitted,
    authorize: (accountId, action, capabilities) =>
      roles.has(accountId)
        ? bouncer.with(DataPolicy).allows(action, { accountId, capabilities })
        : Promise.resolve(false),
  }
}
