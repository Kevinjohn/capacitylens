import { Bouncer } from '@adonisjs/bouncer';
import DataPolicy from '#policies/data_policy';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import { isAccountRole, type Role } from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { actorIn } from '#services/auth/current_actor';
import { restrictedCompanyIds } from '#services/auth/authorization';
import { effectiveReadPrincipal } from '#services/auth/masquerade';
import { activeMembershipsByCompany } from '#services/membership/package_projection';
import type { HttpContext } from '@adonisjs/core/http';

export interface BatchCapabilities {
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  canWrite: boolean;
  canAnonymise: boolean;
  canSeePrivateNames: boolean;
  canSeeTimeOffNote: boolean;
}

export interface BatchDataContext extends BatchCapabilities {
  actorId: string;
  logCommitted: (event: { applied: number; changed: number }) => void | Promise<void>;
  capabilitiesFor: (accountId: string) => BatchCapabilities;
  authorize: (
    accountId: string,
    action: 'write' | 'anonymise',
    capabilities: BatchCapabilities
  ) => Promise<boolean>;
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
  };
  const bouncer = new Bouncer({ id: actorId });
  return {
    actorId,
    ...capabilities,
    logCommitted,
    capabilitiesFor: () => capabilities,
    authorize: (accountId, action, resolved) =>
      bouncer.with(DataPolicy).allows(action, { accountId, capabilities: resolved }),
  };
}

/** Builds role capabilities from transaction-current active memberships for signed-in data writes. */
export async function dataContextForActor(
  ctx: HttpContext,
  trx: TransactionClientContract,
  logCommitted: BatchDataContext['logCommitted'] = () => {}
): Promise<BatchDataContext> {
  const actor = actorIn(trx);
  const principal = await effectiveReadPrincipal(ctx, trx, ctx.params.accountId);
  const restricted = await restrictedCompanyIds(principal.effectiveId, trx);
  const memberships = await activeMembershipsByCompany(principal.effectiveId, trx, restricted);
  const roles = new Map<string, Role>();
  for (const [accountId, membership] of memberships) {
    if (
      (principal.accountId === null || principal.accountId === accountId) &&
      isAccountRole(membership.role)
    ) {
      roles.set(accountId, membership.role);
    }
  }
  const capabilitiesFor = (accountId: string): BatchCapabilities => {
    const role = roles.get(accountId) ?? 'viewer';
    return {
      role,
      canWrite: roles.has(accountId) && access.can(role, 'planning:write'),
      canAnonymise: roles.has(accountId) && access.can(role, 'resources:anonymise'),
      canSeePrivateNames: roles.has(accountId) && canSeePrivateNames(role),
      canSeeTimeOffNote: roles.has(accountId) && canSeeTimeOffNote(role),
    };
  };
  const bouncer = new Bouncer({ id: actor.userId });
  return {
    actorId: actor.userId,
    ...capabilitiesFor(''),
    capabilitiesFor,
    logCommitted,
    authorize: (accountId, action, capabilities) =>
      roles.has(accountId)
        ? bouncer.with(DataPolicy).allows(action, { accountId, capabilities })
        : Promise.resolve(false),
  };
}
