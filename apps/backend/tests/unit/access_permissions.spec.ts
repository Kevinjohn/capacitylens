import { test } from '@japa/runner';
import {
  PERMISSION_KEYS,
  accessPermissions,
  accessRoles,
} from '@capacitylens/shared/account/permissions';
import type { PermissionKey } from '@capacitylens/shared/account/permissions';
import access from '#config/access_control';

const thresholds = accessPermissions as Record<string, Record<string, string>>;
const rank = (role: string) => (accessRoles as readonly string[]).indexOf(role);

function thresholdOf(key: PermissionKey): string {
  const [resource, action] = key.split(':') as [string, string];
  const threshold = thresholds[resource]?.[action];
  if (threshold === undefined) throw new Error(`No threshold declared for ${key}.`);
  return threshold;
}

test.group('Access Control permission parity', () => {
  test('every role holds exactly the keys at or below its rank', ({ assert }) => {
    for (const role of accessRoles) {
      for (const key of PERMISSION_KEYS) {
        assert.equal(access.can(role, key), rank(role) >= rank(thresholdOf(key)), `${role} ${key}`);
      }
    }
  });

  test('Admins and Owners assign every role except Owner', ({ assert }) => {
    assert.deepEqual(access.assignableRoles('admin'), ['viewer', 'editor', 'admin']);
    assert.deepEqual(access.assignableRoles('owner'), ['viewer', 'editor', 'admin']);
  });
});
