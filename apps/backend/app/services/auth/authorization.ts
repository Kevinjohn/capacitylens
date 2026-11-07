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

/** A stored role outside the product vocabulary is corruption: refuse rather than guess. */
export function storedRole(membership: Membership): Role {
  if (!isAccountRole(membership.role)) {
    throw new IdentityAuthorityError('Invalid membership role.');
  }
  return membership.role;
}

/** The user's active membership in the company, read through the caller's transaction. */
export async function activeMembership(userId: string, accountId: string, trx: Reader) {
  const membership = await access.memberships.find(accountId, userId, trx);
  return membership?.status === 'active' ? membership : null;
}

/** Resolves active company standing for ordinary data and member policies. */
export async function activeCompanyRole(
  userId: string,
  accountId: string,
  trx: Reader
): Promise<Role | null> {
  const membership = await activeMembership(userId, accountId, trx);
  return membership ? storedRole(membership) : null;
}

/** A Bouncer whose abilities are the Access Control permission keys for this membership. */
export function memberBouncer(userId: string, membership: Membership | null) {
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
  const membership = await activeMembership(actor.userId, accountId, trx);
  if (!membership || !(await memberBouncer(actor.userId, membership).allows(key))) {
    throw new IdentityAuthorityError('Forbidden.');
  }
  return { actorId: actor.userId, role: storedRole(membership) };
}

/** The user's active company ids in ascending order, read through the caller's transaction. */
export async function activeCompanyIds(userId: string, trx: Reader): Promise<string[]> {
  const memberships = await access.memberships.listForUser(userId, trx);
  return memberships
    .filter((membership) => membership.status === 'active')
    .map((membership) => String(membership.scopeId))
    .sort();
}
