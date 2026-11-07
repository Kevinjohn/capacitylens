import { describe, it, expect } from 'vitest';
import {
  canSeeTimeOffNote,
  canSeePrivateNames,
  canReadInactiveExport,
  canViewCapacityOverview,
} from './access.js';
import type { CapacityOverviewAccess } from '../types/entities.js';
import type { Role } from './access.js';

// The expected booleans below are hard-coded by hand from the Decisions field-visibility rules, not
// derived from the implementation. Role thresholds are tested against the Access Control declaration
// in apps/backend/tests/unit/access_permissions.spec.ts.

// The closed set of roles, hard-coded (not imported as a list) so the test is its own source of truth.
const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer'];

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

describe('canReadInactiveExport(role) — inactive export slice (owner/admin only)', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['editor', false],
    ['viewer', false],
  ] as const)('%s → %s', (role, expected) => {
    expect(canReadInactiveExport(role)).toBe(expected);
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
