import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import {
  NO_ACCESS,
  PermissionContext,
  useAccessGrant,
  useCan,
  useCanEdit,
} from './permissionContext';
import type { PermissionContextValue } from './permissionContext';
import { ROLES } from '@capacitylens/shared/account/types';
import type { PermissionKey } from '@capacitylens/shared/domain/access';
import { grantFor, permissionValue, masqueradeGrantFor } from '@/test/permissionGrants';

// Decisions follow the grant the server sent; the role is never evaluated.

// Keep the sweep explicit and reject entries that are not valid permission keys.
const ACTIONS = [
  'planning:read',
  'planning:write',
  'members:list',
  'members:manage',
  'members:signInTracking',
  'invitations:manage',
  'masquerade:use',
  'resources:anonymise',
  'company:import',
  'company:anonymise',
  'ownership:transfer',
] as const satisfies readonly PermissionKey[];

const withValue =
  (value: PermissionContextValue) =>
  ({ children }: { children: ReactNode }) => (
    <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
  );

describe('useCan', () => {
  it('reports each key the resolved grant holds', () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const { result } = renderHook(() => useCan(action), {
          wrapper: withValue(permissionValue(role)),
        });
        expect(result.current, `${role}/${action}`).toBe(
          grantFor(role).permissions.includes(action),
        );
      }
    }
  });

  it('follows the grant, not the role', () => {
    const value = {
      role: 'owner' as const,
      status: 'resolved' as const,
      grant: grantFor('viewer'),
    };
    const { result } = renderHook(() => useCan('planning:write'), { wrapper: withValue(value) });
    expect(result.current).toBe(false);
  });

  it('denies every action, reads included, while the lookup is pending', () => {
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action), {
        wrapper: withValue(permissionValue('owner', 'pending')),
      });
      expect(result.current, action).toBe(false);
    }
  });

  it('fails closed when the permission provider is missing', () => {
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action));
      expect(result.current, action).toBe(false);
    }
    const { result } = renderHook(() => useAccessGrant());
    expect(result.current).toEqual(NO_ACCESS);
  });

  it('permits only reads under a view-as grant', () => {
    const value = {
      role: 'owner' as const,
      status: 'resolved' as const,
      grant: masqueradeGrantFor('owner'),
    };
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action), { wrapper: withValue(value) });
      expect(result.current, action).toBe(action === 'planning:read');
    }
  });
});

describe('useCanEdit', () => {
  it("is exactly useCan('planning:write') for every role, including unresolved", () => {
    for (const role of [...ROLES, null]) {
      const { result } = renderHook(
        () => ({ edit: useCanEdit(), write: useCan('planning:write') }),
        {
          wrapper: withValue(permissionValue(role)),
        },
      );
      expect(result.current.edit, `${role}`).toBe(result.current.write);
    }
  });
});
