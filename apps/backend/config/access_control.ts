/**
 * Access Control's Account Kit callbacks decide who may invite, create the invited membership and
 * remove memberships when an account is deleted; the product adds the audit entry and planning
 * revision in the same transaction.
 */
import { defineAccessControl } from '@kevinjohn/adonisjs-access-control';
import { accessPermissions, accessRoles } from '@capacitylens/shared/domain/access';

/** Company memberships: `accounts` is the scope table; string keys match the users table. */
export default defineAccessControl({
  roles: accessRoles,
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'string' },
  scope: { table: 'accounts', keyType: 'string' },
  permissions: accessPermissions,
});
