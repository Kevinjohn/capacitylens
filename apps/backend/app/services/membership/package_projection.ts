import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { Membership } from '@kevinjohn/adonisjs-access-control/types';
import { isAccountRole, type Role } from '@capacitylens/shared/account/types';
import access from '#config/access_control';

type Trx = TransactionClientContract;

export type MembershipLifecycle = 'active' | 'archived';

/** The product lifecycle of a package membership: `suspended` is shown as archived. */
export function lifecycleOf(membership: Membership): MembershipLifecycle {
  return membership.status === 'active' ? 'active' : 'archived';
}

/** The package status that stores a product lifecycle. */
export function packageStatus(lifecycle: MembershipLifecycle): 'active' | 'suspended' {
  return lifecycle === 'active' ? 'active' : 'suspended';
}

/** Stored roles outside the product vocabulary are corruption, not a request error. */
export function storedRole(membership: Membership): Role {
  if (!isAccountRole(membership.role)) throw new Error('Membership has an invalid role.');
  return membership.role;
}

/** Active owners of a company, by user id. Read-only product SQL on package storage. */
export async function activeOwnerIds(
  trx: Pick<TransactionClientContract, 'from'>,
  accountId: string
): Promise<string[]> {
  const rows = await trx
    .from('company_memberships')
    .where({ scope_id: accountId, role: 'owner', status: 'active' })
    .orderBy('id', 'asc')
    .select('user_id');
  return rows.map((row) => String(row.user_id));
}

/** Every membership of a scope, paging the package listing to exhaustion. The actor needs members:list. */
export async function scopeMemberships(
  trx: Trx | undefined,
  actorId: string,
  accountId: string
): Promise<Membership[]> {
  const items: Membership[] = [];
  let cursor: string | undefined;
  do {
    const page = await access.memberships.listForScope({
      actor: { id: actorId },
      scopeId: accountId,
      cursor,
      limit: 100,
      trx,
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** Active, non-restricted memberships of a user, keyed by company id. */
export async function activeMembershipsByCompany(
  userId: string,
  trx: Trx | undefined,
  restricted: ReadonlySet<string>
): Promise<Map<string, Membership>> {
  const map = new Map<string, Membership>();
  for (const m of await access.memberships.listForUser(userId, trx)) {
    const id = String(m.scopeId);
    if (m.status === 'active' && !restricted.has(id)) map.set(id, m);
  }
  return map;
}

/** A user's active company ids in ascending order, read on the default connection. */
export async function activeMembershipIds(userId: string): Promise<string[]> {
  const memberships = await access.memberships.listForUser(userId);
  return memberships
    .filter((m) => m.status === 'active')
    .map((m) => String(m.scopeId))
    .sort();
}
