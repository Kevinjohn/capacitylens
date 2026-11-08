import { describe, it, expect } from 'vitest';
import { can, canSeeTimeOffNote, canSeePrivateNames, canViewCapacityOverview } from './access.js';
import type { CapacityOverviewAccess } from '../types/entities.js';
import type { PermissionKey, Role } from './access.js';

// An independent oracle of the CapacityLens permission declaration: the expected roles below are
// written by hand from DECISIONS.md, not derived from the implementation.
const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer'];

const LOWEST_ROLE: Record<PermissionKey, Role> = {
  'planning:read': 'viewer',
  'planning:write': 'editor',
  'members:list': 'admin',
  'members:manage': 'admin',
  'members:signInTracking': 'owner',
  'invitations:manage': 'admin',
  'viewAs:use': 'admin',
  'resources:anonymise': 'admin',
  'catalogue:manage': 'admin',
  'ownership:transfer': 'owner',
};

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

describe('can(role, key) — the permission declaration', () => {
  for (const [key, lowest] of Object.entries(LOWEST_ROLE) as [PermissionKey, Role][]) {
    for (const role of ROLES) {
      const expected = RANK[role] >= RANK[lowest];
      it(`can('${role}', '${key}') === ${expected}`, () => {
        expect(can(role, key)).toBe(expected);
      });
    }
  }

  it('denies an unknown role every key', () => {
    for (const key of Object.keys(LOWEST_ROLE) as PermissionKey[]) {
      expect(can('superuser' as Role, key)).toBe(false);
    }
  });

  it('denies an unknown action or resource for every role', () => {
    for (const role of ROLES) {
      expect(can(role, 'planning:delete' as PermissionKey)).toBe(false);
      expect(can(role, 'unknown:read' as PermissionKey)).toBe(false);
    }
  });

  it('denies keys that only resolve through the object prototype', () => {
    for (const role of ROLES) {
      for (const key of [
        '__proto__:toString',
        'constructor:name',
        'planning:constructor',
        'planning:__proto__',
        'planning',
        ':read',
      ]) {
        expect(can(role, key as PermissionKey)).toBe(false);
      }
    }
  });
});

describe('canSeeTimeOffNote(role) — field-level rule (owner/admin only)', () => {
  it('owner may see the time-off note', () => {
    expect(canSeeTimeOffNote('owner')).toBe(true);
  });
  it('admin may see the time-off note', () => {
    expect(canSeeTimeOffNote('admin')).toBe(true);
  });
  it('editor may NOT see the time-off note', () => {
    expect(canSeeTimeOffNote('editor')).toBe(false);
  });
  it('viewer may NOT see the time-off note', () => {
    expect(canSeeTimeOffNote('viewer')).toBe(false);
  });
});

describe('canSeePrivateNames(role) — field-level rule (owner only)', () => {
  it.each([
    ['owner', true],
    ['admin', false],
    ['editor', false],
    ['viewer', false],
  ] as const)('%s → %s', (role, expected) => {
    expect(canSeePrivateNames(role)).toBe(expected);
  });
});

describe('canViewCapacityOverview(role, access) — account setting policy', () => {
  const settings: readonly CapacityOverviewAccess[] = [
    'owner_admin',
    'owner_admin_editor',
    'everyone',
  ];

  it('defaults to owner/admin when the setting is absent or malformed', () => {
    expect(canViewCapacityOverview('owner', undefined)).toBe(true);
    expect(canViewCapacityOverview('admin', undefined)).toBe(true);
    expect(canViewCapacityOverview('editor', undefined)).toBe(false);
    expect(canViewCapacityOverview('viewer', 'invalid' as CapacityOverviewAccess)).toBe(false);
  });

  it.each(settings)('applies the %s setting across all roles', (access) => {
    const expected = {
      owner_admin: { owner: true, admin: true, editor: false, viewer: false },
      owner_admin_editor: { owner: true, admin: true, editor: true, viewer: false },
      everyone: { owner: true, admin: true, editor: true, viewer: true },
    }[access];
    for (const role of ROLES) expect(canViewCapacityOverview(role, access)).toBe(expected[role]);
  });
});
