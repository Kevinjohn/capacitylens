import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { TeamDirectory, TeamMember } from '@/account/teamAccessClient';
import { AuthContext } from '@/auth/authContext';
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from '@/test/fixtures';
import { authValue } from './MembersSection.testSupport';
import { useTeamDirectory } from './useTeamDirectory';

type MembersRead = Awaited<ReturnType<typeof teamAccessClient.listMembers>>;

function makeDirectory(
  resourceLink: NonNullable<TeamMember['resourceLink']> | null,
): TeamDirectory {
  return {
    signInTrackingEnabled: false,
    resourceCandidates: [{ resourceId: 'r-bruce', label: 'Bruce Wayne' }],
    members: [
      {
        userId: 'ed',
        role: 'editor',
        status: 'active',
        manage: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        name: 'Clark Kent',
        email: 'ed@x.io',
        signInConfirmed: null,
        isSelf: false,
        resourceLink,
      },
    ],
  };
}

// Resolves the first members read at once and holds every later read until the test settles it.
function controlMemberReads() {
  const held: ((result: MembersRead) => void)[] = [];
  const listMembers = vi
    .spyOn(teamAccessClient, 'listMembers')
    .mockResolvedValueOnce({ kind: 'ok', status: 200, value: makeDirectory(null) })
    .mockImplementation(() => new Promise((resolve) => held.push(resolve)));
  vi.spyOn(teamAccessClient, 'listInvitations').mockResolvedValue({
    kind: 'ok',
    status: 200,
    value: [],
  });
  return {
    listMembers,
    async settleNext(result: MembersRead) {
      await waitFor(() => expect(held.length).toBeGreaterThan(0));
      const settle = held.shift();
      await act(async () => {
        settle?.(result);
        await Promise.resolve();
      });
    },
  };
}

function renderDirectory(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const fail = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue()}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(
    () => useTeamDirectory({ enabled: true, activeAccountId: DEFAULT_ACCOUNT_ID, fail }),
    { wrapper },
  );
}

beforeEach(async () => {
  await resetStoreWithAccount();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTeamDirectory read generations', () => {
  it('accepts a requested generation only from its successful members read', async () => {
    const reads = controlMemberReads();
    const { result } = renderDirectory();
    await waitFor(() => expect(result.current.directory.kind).toBe('ready'));
    const accepted = result.current.acceptedReadGeneration;

    let failedGeneration = 0;
    act(() => {
      failedGeneration = result.current.reload();
    });
    expect(failedGeneration).toBeGreaterThan(accepted);
    await reads.settleNext({ kind: 'rejected', status: 500, message: null });
    await waitFor(() => expect(result.current.directory.kind).toBe('error'));
    expect(result.current.acceptedReadGeneration).toBe(accepted);

    let retryGeneration = 0;
    act(() => {
      retryGeneration = result.current.reload();
    });
    expect(retryGeneration).toBeGreaterThan(failedGeneration);
    const linked = { resourceId: 'r-bruce', revision: 'rev-2' };
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(linked) });
    await waitFor(() => expect(result.current.acceptedReadGeneration).toBe(retryGeneration));
    expect(result.current.directory).toMatchObject({
      kind: 'ready',
      snapshot: { members: [{ resourceLink: linked }] },
    });
  });

  it('keeps the accepted generation when another snapshot replacement arrives first', async () => {
    const reads = controlMemberReads();
    const { result } = renderDirectory();
    await waitFor(() => expect(result.current.directory.kind).toBe('ready'));
    const accepted = result.current.acceptedReadGeneration;

    let requested = 0;
    act(() => {
      requested = result.current.reload();
    });
    const replaced = makeDirectory({ resourceId: 'r-bruce', revision: 'rev-2' });
    const replaceAuthorizedDirectory = result.current.beginAuthorizedRead();
    act(() => replaceAuthorizedDirectory(replaced, []));
    expect(result.current.directory).toMatchObject({ snapshot: { members: replaced.members } });
    expect(result.current.acceptedReadGeneration).toBe(accepted);

    await reads.settleNext({ kind: 'ok', status: 200, value: replaced });
    await waitFor(() => expect(result.current.acceptedReadGeneration).toBe(requested));
  });

  // A revisit within the cache lifetime must not accept a cached read from an earlier visit.
  it('requests a generation that a remount cannot satisfy from the shared query cache', async () => {
    const reads = controlMemberReads();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const firstVisit = renderDirectory(queryClient);
    await waitFor(() => expect(firstVisit.result.current.directory.kind).toBe('ready'));
    act(() => {
      firstVisit.result.current.reload();
    });
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(null) });
    firstVisit.unmount();

    const secondVisit = renderDirectory(queryClient);
    await waitFor(() => expect(secondVisit.result.current.directory.kind).toBe('ready'));
    const callsBeforeReload = reads.listMembers.mock.calls.length;
    let requested = 0;
    act(() => {
      requested = secondVisit.result.current.reload();
    });
    await waitFor(() =>
      expect(reads.listMembers.mock.calls.length).toBeGreaterThan(callsBeforeReload),
    );
    expect(secondVisit.result.current.acceptedReadGeneration).toBeLessThan(requested);

    const linked = { resourceId: 'r-bruce', revision: 'rev-2' };
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(linked) });
    await reads.settleNext({ kind: 'ok', status: 200, value: makeDirectory(linked) });
    await waitFor(() => expect(secondVisit.result.current.acceptedReadGeneration).toBe(requested));
  });
});
