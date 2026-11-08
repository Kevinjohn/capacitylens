import { Bouncer } from '@adonisjs/bouncer';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
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

/** Builds a Bouncer whose abilities are the Access Control permission keys for this membership. */
export function createMemberBouncer(userId: string, membership: Membership | null) {
  return new Bouncer(
    { id: userId },
    access.abilities(() => membership)
  );
}

/** Authorizes one company permission from live membership inside the actor's verified transaction. */
export async function assertCompanyAction(
  accountId: string,
  key: PermissionKey,
  trx: TransactionClientContract
): Promise<{ actorId: string; role: Role }> {
  const actor = actorIn(trx);
  const membership = await getActiveMembership(actor.userId, accountId, trx);
  if (!membership || !(await createMemberBouncer(actor.userId, membership).allows(key))) {
    throw new IdentityAuthorityError('Forbidden.');
  }
  return { actorId: actor.userId, role: requireStoredRole(membership) };
}

/** Lists the user's active company ids in ascending order, reading through the caller's transaction. */
export async function listActiveCompanyIds(userId: string, trx: Reader): Promise<string[]> {
  const memberships = await access.memberships.listForUser(userId, trx);
  return memberships
    .filter((membership) => membership.status === 'active')
    .map((membership) => String(membership.scopeId))
    .sort();
}
