import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { Membership } from '@kevinjohn/adonisjs-access-control/types';
import { isAccountRole, type Role } from '@capacitylens/shared/account/types';

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
