import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PermissionContext, useCan, useCanEdit } from './permissionContext';
import type { Action } from './permissionContext';
import type { Role } from '@capacitylens/shared/domain/access';
import { actionPermission } from '@capacitylens/shared/account/permissions';
import { demoCan } from '@/lib/demoAccess';
import { useStore } from '@/store/useStore';
import { authorityFixture, authorityFor } from '@/test/authorityFixture';

// Server mode reads only the resolved authority snapshot; demo mode evaluates Owner-level
// capability from the shared declaration; masquerade permits read only.

const ACTIONS = Object.keys(actionPermission) as Action[];
const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer'];

beforeEach(() => useStore.getState().setMasquerade({ kind: 'inactive' }));
afterEach(() => vi.unstubAllEnvs());

const withResolved =
  (role: Role | null) =>
  ({ children }: { children: ReactNode }) => (
    <PermissionContext.Provider
      value={{ role, status: role ? 'resolved' : 'not-applicable', access: authorityFor(role) }}
    >
      {children}
    </PermissionContext.Provider>
  );

describe('useCan in server mode', () => {
  it('denies read without a provider', () => {
    const { result } = renderHook(() => useCan('read'));
    expect(result.current).toBe(false);
  });

  it('allows write for a resolved editor fixture and denies it for a viewer', () => {
    const editor = renderHook(() => useCan('write'), { wrapper: withResolved('editor') });
    const viewer = renderHook(() => useCan('write'), { wrapper: withResolved('viewer') });
    expect(editor.result.current).toBe(true);
    expect(viewer.result.current).toBe(false);
  });

  it('follows the resolved permission list for every role and action', () => {
    for (const role of ROLES) {
      const permissions = authorityFixture(role).permissions;
      for (const action of ACTIONS) {
        const { result } = renderHook(() => useCan(action), { wrapper: withResolved(role) });
        expect(result.current, `${role}/${action}`).toBe(
          permissions.includes(actionPermission[action]),
        );
      }
    }
  });

  it('denies a role whose lookup is pending even when access is present', () => {
    const { result } = renderHook(() => useCan('read'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PermissionContext.Provider
          value={{ role: 'owner', status: 'pending', access: authorityFixture('owner') }}
        >
          {children}
        </PermissionContext.Provider>
      ),
    });
    expect(result.current).toBe(false);
  });

  it('permits only read while masquerade is active and nothing while it is changing', () => {
    act(() =>
      useStore.getState().setMasquerade({
        kind: 'starting',
        pending: { accountId: 'a-studio', targetUserId: 'u-viewer' },
        generation: 1,
      }),
    );
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action), { wrapper: withResolved('owner') });
      expect(result.current, `starting/${action}`).toBe(false);
    }
    act(() =>
      useStore.getState().setMasquerade({
        kind: 'active',
        generation: 1,
        state: {
          accountId: 'a-studio',
          targetUserId: 'u-viewer',
          targetName: 'Selina Kyle',
          effectiveRole: 'viewer',
          startedAt: '2026-09-01T10:00:00.000Z',
          expiresAt: '2999-09-01T10:15:00.000Z',
          token: 'context-proof',
        },
      }),
    );
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action), { wrapper: withResolved('owner') });
      expect(result.current, `active/${action}`).toBe(action === 'read');
    }
  });
});

describe('useCan in demo mode', () => {
  it('allows each action exactly when demoCan does, with or without a provider', () => {
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1');
    for (const action of ACTIONS) {
      const { result } = renderHook(() => useCan(action));
      expect(result.current, action).toBe(demoCan(action));
    }
    expect(ACTIONS.every((action) => demoCan(action))).toBe(true);
  });
});

describe('useCanEdit', () => {
  it("is exactly useCan('write') for every role, including null", () => {
    for (const role of [...ROLES, null]) {
      const { result } = renderHook(() => ({ edit: useCanEdit(), write: useCan('write') }), {
        wrapper: withResolved(role),
      });
      expect(result.current.edit, `${role}`).toBe(result.current.write);
    }
  });
});
