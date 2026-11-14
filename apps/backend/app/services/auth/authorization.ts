import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { AccessControlError } from '@kevinjohn/adonisjs-access-control';
import type { Membership } from '@kevinjohn/adonisjs-access-control/types';
import { isAccountRole, type Role } from '@capacitylens/shared/account/types';
import type { PermissionKey } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { actorIn } from '#services/auth/current_actor';

/** A transaction, or none where a caller has none; reads then use the default connection. */
type Reader = TransactionClientContract | undefined;

export class IdentityAuthorityError extends Error {
  code = 'IDENTITY_AUTHORITY_DENIED';
  status = 403;
}

/** Returns the membership's role, or throws when storage holds a role outside the product vocabulary. */
export function requireStoredRole(membership: Membership): Role {
  if (!isAccountRole(membership.role)) {
    throw new IdentityAuthorityError('Invalid membership role.');
  }
  return membership.role;
}

/** Returns the user's active membership in the company, or null; reads through the caller's transaction. */
export async function getActiveMembership(userId: string, accountId: string, trx: Reader) {
  const membership = await access.memberships.find(accountId, userId, trx);
  return membership?.status === 'active' ? membership : null;
}

/** Resolves active company standing for ordinary data and member policies. */
export async function activeCompanyRole(
  userId: string,
  accountId: string,
  trx: Reader
): Promise<Role | null> {
  const membership = await getActiveMembership(userId, accountId, trx);
  return membership ? requireStoredRole(membership) : null;
}

/** Authorizes one company permission from live membership inside the actor's verified transaction. */
export async function assertCompanyAction(
  accountId: string,
  key: PermissionKey,
  trx: TransactionClientContract
): Promise<{ actorId: string; role: Role }> {
  const actor = actorIn(trx);
  try {
    const membership = await access.memberships.authorize({
      scopeId: accountId,
      userId: actor.userId,
      permission: key,
      trx,
    });
    return { actorId: actor.userId, role: requireStoredRole(membership) };
  } catch (error) {
    if (error instanceof AccessControlError && error.code === 'E_ACCESS_CONTROL_FORBIDDEN') {
      throw new IdentityAuthorityError('Forbidden.');
    }
    throw error;
  }
}

/** Lists the user's active company ids in ascending order, reading through the caller's transaction. */
export async function listActiveCompanyIds(userId: string, trx: Reader): Promise<string[]> {
  const memberships = await access.memberships.listForUser(userId, trx);
  return memberships
    .filter((membership) => membership.status === 'active')
    .map((membership) => String(membership.scopeId))
    .sort();
}
