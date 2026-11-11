import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { TeamMember } from '@/account/teamAccessClient';
import { useMemberResourceLinkRequests } from './useMemberResourceLinkRequest';

const member: TeamMember = {
  userId: 'ed',
  role: 'editor',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Clark Kent',
  email: 'ed@x.io',
  signInConfirmed: null,
  isSelf: false,
  manage: true,
  resourceLink: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMemberResourceLinkRequest', () => {
  it('ignores a response that arrives after the company changed', async () => {
    let settle: (
      value: Awaited<ReturnType<typeof teamAccessClient.setMemberResourceLink>>,
    ) => void = () => {};
    vi.spyOn(teamAccessClient, 'setMemberResourceLink').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const reload = vi.fn(() => 1);
    const { result, rerender } = renderHook(
      ({ workspaceId }) =>
        useMemberResourceLinkRequests({
          workspaceId,
          reload,
          acceptedReadGeneration: 0,
          members: [member],
        })(member),
      { initialProps: { workspaceId: 'a-studio' as string | null } },
    );

    act(() => result.current.change('r-bruce'));
    expect(result.current.pending).toBe(true);
    rerender({ workspaceId: 'a-loft' });
    await act(async () => {
      settle({ kind: 'unknown', status: 409, message: 'The operation may have completed.' });
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reports an uncertain outcome and stays pending until its requested read is accepted', async () => {
    vi.spyOn(teamAccessClient, 'setMemberResourceLink').mockResolvedValue({
      kind: 'unknown',
      status: 409,
      message: 'The operation may have completed.',
    });
    const reload = vi.fn(() => 3);
    const { result, rerender } = renderHook(
      ({ acceptedReadGeneration }) =>
        useMemberResourceLinkRequests({
          workspaceId: 'a-studio',
          reload,
          acceptedReadGeneration,
          members: [member],
        })(member),
      { initialProps: { acceptedReadGeneration: 1 } },
    );

    await act(async () => {
      result.current.change('r-bruce');
      await Promise.resolve();
    });

    expect(result.current.error).not.toBeNull();
    expect(reload).toHaveBeenCalledOnce();
    expect(result.current.pending).toBe(true);
    rerender({ acceptedReadGeneration: 2 });
    expect(result.current.pending).toBe(true);
    rerender({ acceptedReadGeneration: 3 });
    expect(result.current.pending).toBe(false);
  });

  it('drops settled requests for members a newer accepted read no longer lists', async () => {
    const bea: TeamMember = { ...member, userId: 'bea', name: 'Barbara Gordon', email: 'bea@x.io' };
    vi.spyOn(teamAccessClient, 'setMemberResourceLink').mockImplementation((input) =>
      input.principalId === 'ed'
        ? Promise.resolve({ kind: 'rejected', status: 409, message: 'Changed elsewhere.' })
        : new Promise(() => {}),
    );
    const reload = vi.fn(() => 1);
    const { result, rerender } = renderHook(
      ({ acceptedReadGeneration, members }) =>
        useMemberResourceLinkRequests({
          workspaceId: 'a-studio',
          reload,
          acceptedReadGeneration,
          members,
        }),
      { initialProps: { acceptedReadGeneration: 0, members: [member, bea] } },
    );
    await act(async () => {
      result.current(member).change('r-bruce');
      result.current(bea).change('r-diana');
      await Promise.resolve();
    });
    rerender({ acceptedReadGeneration: 1, members: [member, bea] });
    expect(result.current(member).error).toBe('Changed elsewhere.');

    // Both leave the directory; Barbara's request is still sending, so it is kept.
    rerender({ acceptedReadGeneration: 2, members: [] });
    expect(result.current(member).error).toBeNull();
    expect(result.current(bea).pending).toBe(true);
  });
});
