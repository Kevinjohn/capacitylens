import { describe, expect, it } from 'vitest';
import { resolveCapacityOverviewAccessDecision } from './capacityOverviewAccess';

describe('resolveCapacityOverviewAccessDecision', () => {
  it('denies access when no account role applies', () => {
    expect(
      resolveCapacityOverviewAccessDecision({
        role: null,
        status: 'not-applicable',
        access: 'owner_admin',
      }),
    ).toBe('denied');
  });

  it('waits while an authenticated role is unresolved', () => {
    expect(
      resolveCapacityOverviewAccessDecision({
        role: 'viewer',
        status: 'pending',
        access: 'everyone',
      }),
    ).toBe('pending');
  });

  it.each([
    ['owner', 'owner_admin', 'allowed'],
    ['admin', 'owner_admin', 'allowed'],
    ['editor', 'owner_admin', 'denied'],
    ['editor', 'owner_admin_editor', 'allowed'],
    ['viewer', 'owner_admin_editor', 'denied'],
    ['viewer', 'everyone', 'allowed'],
  ] as const)('resolves %s under %s as %s', (role, access, expected) => {
    expect(resolveCapacityOverviewAccessDecision({ role, status: 'resolved', access })).toBe(
      expected,
    );
  });

  it('fails closed when role verification is unavailable', () => {
    expect(
      resolveCapacityOverviewAccessDecision({
        role: 'viewer',
        status: 'unavailable',
        access: 'everyone',
      }),
    ).toBe('denied');
  });
});
