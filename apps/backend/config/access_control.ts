// Company memberships are stored and ruled by `@kevinjohn/adonisjs-access-control`: its
// `memberships` table, the roles viewer < editor < admin < owner and the permission keys declared
// once in `packages/shared/src/domain/access.ts`. The package owns the Bouncer abilities for each
// permission key.

import { defineAccessControl } from '@kevinjohn/adonisjs-access-control';
import { accessPermissions, accessRoles } from '@capacitylens/shared/domain/access';

/** Company memberships: `companies` is the scope table; string keys match the users table. */
export default defineAccessControl({
  roles: accessRoles,
  ownerRole: 'owner',
  users: { table: 'users', keyType: 'string' },
  scope: { table: 'companies', keyType: 'string' },
  permissions: accessPermissions,
});
