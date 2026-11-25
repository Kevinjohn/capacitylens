import access from '#config/access_control';
import type { Role } from '@capacitylens/shared/account/types';
import {
  accessPermissions,
  canSeePrivateNames,
  canSeeTimeOffNote,
  type AccessGrant,
  type PermissionKey,
} from '@capacitylens/shared/domain/access';

const permissionKeys = Object.entries(accessPermissions).flatMap(([resource, actions]) =>
  Object.keys(actions).map((action) => `${resource}:${action}` as PermissionKey)
);

/** The permission keys and field-visibility flags a role holds, for the browser. */
export class AccessGrantService {
  /**
   * The permission keys and field-visibility flags `role` holds, for the browser to show or hide
   * controls. A view-as is read-only, so it keeps only `planning:read`; the flags stay the role's,
   * matching the projection the target receives. Server enforcement does not read this.
   */
  buildAccessGrant(role: Role, viewingAs: boolean): AccessGrant {
    const held = permissionKeys.filter((key) => access.can(role, key));
    return {
      permissions: viewingAs ? held.filter((key) => key === 'planning:read') : held,
      canSeePrivateNames: canSeePrivateNames(role),
      canSeeTimeOffNote: canSeeTimeOffNote(role),
    };
  }
}
