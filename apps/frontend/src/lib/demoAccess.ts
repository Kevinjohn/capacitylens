import {
  accessPermissions,
  accessRoles,
  actionPermission,
} from '@capacitylens/shared/account/permissions';

type Action = keyof typeof actionPermission;
type PermissionTable = Record<string, Record<string, (typeof accessRoles)[number]>>;

/** Demo capability: the in-memory demo acts as Owner, evaluated from the shared declaration. */
export function demoCan(action: Action): boolean {
  const [resource = '', act = ''] = actionPermission[action].split(':');
  const threshold = (accessPermissions as PermissionTable)[resource]?.[act];
  return threshold !== undefined && accessRoles.indexOf('owner') >= accessRoles.indexOf(threshold);
}
