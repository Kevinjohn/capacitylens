import { Bouncer } from '@adonisjs/bouncer'
import DataPolicy from '#policies/data_policy'

export interface BatchCapabilities {
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  canWrite: boolean
  canPurge: boolean
  canSeePrivateNames: boolean
  canSeeTimeOffNote: boolean
}

export interface BatchDataContext extends BatchCapabilities {
  actorId: string
  multiAccount: boolean
  logCommitted: (event: { applied: number; changed: number }) => void | Promise<void>
  capabilitiesFor: (accountId: string) => BatchCapabilities
  authorize: (
    accountId: string,
    action: 'write' | 'purge',
    capabilities: BatchCapabilities
  ) => Promise<boolean>
}

/** Trusted-local mode resolves the same explicit capabilities a future provider-backed guard supplies. */
export function trustedLocalDataContext(
  actorId: string,
  multiAccount: boolean,
  logCommitted: BatchDataContext['logCommitted'] = () => {}
): BatchDataContext {
  const capabilities = {
    role: 'owner' as const,
    canWrite: true,
    canPurge: true,
    canSeePrivateNames: true,
    canSeeTimeOffNote: true,
  }
  const bouncer = new Bouncer({ id: actorId })
  return {
    actorId,
    multiAccount,
    ...capabilities,
    logCommitted,
    capabilitiesFor: () => capabilities,
    authorize: (accountId, action, resolved) =>
      bouncer.with(DataPolicy).allows(action, { accountId, capabilities: resolved }),
  }
}
