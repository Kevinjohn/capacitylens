import { defineAccessControl } from '@kevinjohn/adonisjs-access-control';
import { accessPermissions, accessRoles } from '@capacitylens/shared/account/permissions';

/** Company memberships: `accounts` is the scope table; string keys match the users table. */
export default defineAccessControl({
  roles: accessRoles,
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'string' },
  scope: { table: 'accounts', keyType: 'string' },
  membershipsTable: 'company_memberships',
  permissions: accessPermissions,
});
