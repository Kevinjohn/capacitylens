import { describe, expect, it } from 'vitest';
import type { Action } from '../domain/access.js';
import {
  PERMISSION_KEYS,
  accessRoles,
  actionPermission,
  parseCompanyAccess,
  parseMemberActions,
} from './permissions.js';
import { ACCOUNT_ROLES } from './types.js';

// Hard-coded so a new Action must be added here deliberately; `satisfies` rejects unknown names.
const ACTIONS = [
  'read',
  'write',
  'manageInternalClient',
  'manageMembers',
  'manageInvites',
  'masquerade',
  'manageMemberSignInTracking',
  'anonymise',
  'transferOwnership',
  'actOnOwnershipTransfer',
] as const satisfies readonly Action[];

describe('access role order', () => {
  it('has the same members as ACCOUNT_ROLES and ends with owner', () => {
    expect([...accessRoles].sort()).toEqual([...ACCOUNT_ROLES].sort());
    expect(accessRoles).toHaveLength(ACCOUNT_ROLES.length);
    expect(accessRoles.at(-1)).toBe('owner');
  });
});

describe('PERMISSION_KEYS', () => {
  it('has 13 entries including the package-reserved keys', () => {
    expect(PERMISSION_KEYS).toHaveLength(13);
    expect(PERMISSION_KEYS).toContain('members:list');
    expect(PERMISSION_KEYS).toContain('members:manage');
    expect(PERMISSION_KEYS).toContain('invitations:manage');
  });
});

describe('actionPermission', () => {
  it('maps every Action to a declared permission key', () => {
    expect(Object.keys(actionPermission).sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) {
      expect(PERMISSION_KEYS).toContain(actionPermission[action]);
    }
  });
});

describe('parseCompanyAccess', () => {
  const expected = { scopeId: 'company-daily-planet', role: 'admin' } as const;
  const valid = {
    scopeId: 'company-daily-planet',
    role: 'admin',
    permissions: ['planning:read', 'planning:write', 'planning:read', 'members:list'],
    assignableRoles: ['viewer', 'editor', 'admin'],
  };

  it('accepts a valid payload and de-duplicates permissions', () => {
    expect(parseCompanyAccess(valid, expected)).toEqual({
      scopeId: 'company-daily-planet',
      role: 'admin',
      permissions: ['planning:read', 'planning:write', 'members:list'],
      assignableRoles: ['viewer', 'editor', 'admin'],
    });
  });

  it('rejects a scope mismatch', () => {
    expect(
      parseCompanyAccess({ ...valid, scopeId: 'company-wayne-enterprises' }, expected),
    ).toBeNull();
  });

  it('rejects a role mismatch', () => {
    expect(parseCompanyAccess({ ...valid, role: 'owner' }, expected)).toBeNull();
  });

  it('rejects an unknown permission key', () => {
    expect(
      parseCompanyAccess({ ...valid, permissions: ['planning:read', 'planning:delete'] }, expected),
    ).toBeNull();
  });

  it('rejects owner in assignableRoles', () => {
    expect(
      parseCompanyAccess({ ...valid, assignableRoles: ['viewer', 'owner'] }, expected),
    ).toBeNull();
  });

  it('rejects non-array permissions and assignableRoles', () => {
    expect(parseCompanyAccess({ ...valid, permissions: 'planning:read' }, expected)).toBeNull();
    expect(parseCompanyAccess({ ...valid, assignableRoles: 'viewer' }, expected)).toBeNull();
    expect(parseCompanyAccess(null, expected)).toBeNull();
  });
});

describe('parseMemberActions', () => {
  const valid = {
    changeRole: true,
    changeStatus: false,
    remove: true,
    enableAccess: false,
    viewAs: true,
  };

  it('accepts all five boolean flags', () => {
    expect(parseMemberActions(valid)).toEqual(valid);
  });

  it('rejects a missing flag', () => {
    const missing: Record<string, unknown> = { ...valid };
    delete missing.viewAs;
    expect(parseMemberActions(missing)).toBeNull();
  });

  it('rejects a string flag', () => {
    expect(parseMemberActions({ ...valid, remove: 'true' })).toBeNull();
  });
});
