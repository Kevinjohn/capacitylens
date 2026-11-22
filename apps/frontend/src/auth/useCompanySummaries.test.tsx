import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  fetchCompanySummaries,
  refreshCompanySummaries,
  useCompanySummaries,
} from './useCompanySummaries';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import { grantFor, masqueradeGrantFor } from '@/test/permissionGrants';
import { createDeferred } from '@/test/createDeferred';

// Only a genuine empty array may clear the directory. Malformed responses or an array with no valid rows preserve the existing list; mixed responses keep valid rows and log discarded entries.

afterEach(() => {
  useStore.setState({ activeCompanyId: null, masquerade: { kind: 'inactive' } });
  useStore.getState().setCompanySummaries({ list: [] });
  useStore.getState().setNotice(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A 2xx answer arrives inside the `{ data }` envelope; a refusal is flat.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(status < 300 ? { data: body } : body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function createBasicResponseClassificationTests() {
  it('a genuine empty array -> [] (the real "no companies" answer)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [])),
    );
    await expect(fetchCompanySummaries()).resolves.toEqual([]);
  });

  it("clears stale company choices and shows the server's ambiguous-installation error", async () => {
    useStore.getState().setCompanySummaries({
      list: [{ id: 'old-company', name: 'Old company', role: 'owner' }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, { error: 'This installation has more than one company.' })),
    );
    await expect(fetchCompanySummaries()).resolves.toBeNull();
    expect(useStore.getState().companySummaries).toEqual([]);
    expect(useStore.getState().companySummariesComplete).toBe(false);
    expect(useStore.getState().companySummariesAmbiguous).toBe(true);
    expect(useStore.getState().notice?.message).toBe(m.account_directory_ambiguous());
  });

  it('a valid array -> validated summaries (off-spec rows dropped, not the whole list) + a warn per drop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = [
      { id: 'a1', name: 'Studio A', role: 'editor', ...grantFor('editor') },
      { bogus: true },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, body)),
    );
    await expect(fetchCompanySummaries()).resolves.toEqual([
      { id: 'a1', name: 'Studio A', role: 'editor', grant: grantFor('editor') },
    ]);
    // Partial corruption is handled-but-logged (DEFENSIVE-CODING §5): the dropped row leaves a breadcrumb.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 malformed'));
    expect(useStore.getState().notice).toEqual({
      message: m.account_directory_incomplete(),
      tone: 'warning',
    });
  });

  it('rejects duplicate account identities instead of making the effective role response-order dependent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, [
          { id: 'a1', name: 'Studio A', role: 'owner', ...grantFor('owner') },
          { id: 'a1', name: 'Studio A', role: 'viewer', ...grantFor('viewer') },
          { bogus: true },
        ]),
      ),
    );

    await expect(fetchCompanySummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate account identities'));
    expect(useStore.getState().notice).toEqual({
      message: m.account_directory_incomplete(),
      tone: 'warning',
    });
  });
}

function createUnknownRoleResponseTest() {
  it('keeps a valid account selectable but marks an unrecognized role unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = { id: 'a1', name: 'Studio A', role: 'future-role' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [row])),
    );

    await expect(fetchCompanySummaries()).resolves.toEqual([
      { id: 'a1', name: 'Studio A', role: 'viewer', roleStatus: 'unavailable' },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unrecognized role'));
  });

  it.each([
    ['no grant', {}],
    ['a non-array permission list', { ...grantFor('owner'), permissions: 'planning:write' }],
    ['a non-string permission key', { ...grantFor('owner'), permissions: [1] }],
    ['a missing private-name flag', { ...grantFor('owner'), canSeePrivateNames: undefined }],
    ['a non-boolean time-off-note flag', { ...grantFor('owner'), canSeeTimeOffNote: 'yes' }],
  ])('marks a row with %s unavailable without a grant', async (_description, grant) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [{ id: 'a1', name: 'Studio A', role: 'owner', ...grant }])),
    );

    await expect(fetchCompanySummaries()).resolves.toEqual([
      { id: 'a1', name: 'Studio A', role: 'viewer', roleStatus: 'unavailable' },
    ]);
  });
}

function createMalformedResponseClassificationTests() {
  it('a NONEMPTY array whose rows are ALL malformed -> null (keep what you have, NOT a fake "no companies") + a warn', async () => {
    // An array containing only invalid entries is a malformed response, not evidence that no companies exist. It must preserve the current directory.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [null])),
    );
    await expect(fetchCompanySummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 malformed'));
    expect(useStore.getState().notice).toEqual({
      message: m.account_directory_incomplete(),
      tone: 'warning',
    });
  });

  it('an id-only row is malformed too: [{"id":"a"}] -> null, not []', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [{ id: 'a' }])),
    );
    await expect(fetchCompanySummaries()).resolves.toBeNull();
  });

  it('a 200 whose body is NOT an array -> null (malformed, not "no companies") + a warn breadcrumb', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { error: 'proxy said what' })),
    );
    await expect(fetchCompanySummaries()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-array'));
  });

  it('a non-OK response -> null (unchanged keep-what-you-have stance)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(503, { error: 'down' })),
    );
    await expect(fetchCompanySummaries()).resolves.toBeNull();
  });
}

describe('fetchCompanySummaries — response classification', () => {
  createBasicResponseClassificationTests();
  createUnknownRoleResponseTest();
  createMalformedResponseClassificationTests();
});

function createOrderedRefreshTests() {
  it('clears the active company when the live directory no longer contains its membership', async () => {
    useStore.setState({ activeCompanyId: 'a1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, [{ id: 'a2', name: 'Other', role: 'viewer', ...grantFor('viewer') }]),
      ),
    );

    await refreshCompanySummaries();

    expect(useStore.getState().activeCompanyId).toBeNull();
    expect(useStore.getState().notice).toMatchObject({
      message: m.notice_company_access_removed(),
      tone: 'warning',
    });
  });

  it('keeps the later-issued directory when two responses resolve in reverse order', async () => {
    const earlier = createDeferred<Response>();
    const later = createDeferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => earlier.promise)
        .mockImplementationOnce(() => later.promise),
    );

    const earlierRefresh = refreshCompanySummaries();
    const laterRefresh = refreshCompanySummaries();
    later.resolve(json(200, [{ id: 'new', name: 'Newest', role: 'owner', ...grantFor('owner') }]));
    await laterRefresh;
    earlier.resolve(json(200, [{ id: 'old', name: 'Older', role: 'owner', ...grantFor('owner') }]));
    await earlierRefresh;

    expect(useStore.getState().companySummaries).toEqual([
      { id: 'new', name: 'Newest', role: 'owner', grant: grantFor('owner') },
    ]);
  });

  it('does not let a superseded response clear the active company or publish a removal notice', async () => {
    const earlier = createDeferred<Response>();
    const later = createDeferred<Response>();
    useStore.setState({ activeCompanyId: 'new' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => earlier.promise)
        .mockImplementationOnce(() => later.promise),
    );

    const earlierRefresh = refreshCompanySummaries();
    const laterRefresh = refreshCompanySummaries();
    later.resolve(json(200, [{ id: 'new', name: 'Newest', role: 'owner', ...grantFor('owner') }]));
    await laterRefresh;
    earlier.resolve(json(200, [{ id: 'old', name: 'Older', role: 'owner', ...grantFor('owner') }]));
    await earlierRefresh;

    expect(useStore.getState().activeCompanyId).toBe('new');
    expect(useStore.getState().notice).toBeNull();
  });
}

function createMutationRefreshTests() {
  it('does not let an in-flight response overwrite a later direct list mutation', async () => {
    const response = createDeferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const refresh = refreshCompanySummaries();

    useStore
      .getState()
      .setCompanySummaries({ list: [{ id: 'created', name: 'Just created', role: 'owner' }] });
    response.resolve(
      json(200, [{ id: 'old', name: 'Before create', role: 'owner', ...grantFor('owner') }]),
    );
    await refresh;

    expect(useStore.getState().companySummaries).toEqual([
      { id: 'created', name: 'Just created', role: 'owner' },
    ]);
  });

  it('does not let a response superseded by a direct mutation clear that newly active company', async () => {
    const response = createDeferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const refresh = refreshCompanySummaries();

    useStore
      .getState()
      .setCompanySummaries({ list: [{ id: 'created', name: 'Just created', role: 'owner' }] });
    useStore.setState({ activeCompanyId: 'created' });
    response.resolve(
      json(200, [{ id: 'old', name: 'Before create', role: 'owner', ...grantFor('owner') }]),
    );
    await refresh;

    expect(useStore.getState().activeCompanyId).toBe('created');
    expect(useStore.getState().notice).toBeNull();
  });
}

function createCompletenessRefreshTests() {
  it('publishes valid rows from an incomplete directory without treating the dropped active row as revoked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useStore.setState({ activeCompanyId: 'active' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, [
          { id: 'active', role: 'owner', ...grantFor('owner') },
          { id: 'other', name: 'Other', role: 'viewer', ...grantFor('viewer') },
        ]),
      ),
    );

    await refreshCompanySummaries();

    expect(useStore.getState().companySummaries).toEqual([
      { id: 'other', name: 'Other', role: 'viewer', grant: grantFor('viewer') },
    ]);
    expect(useStore.getState().companySummariesComplete).toBe(false);
    expect(useStore.getState().activeCompanyId).toBe('active');
    expect(useStore.getState().notice).toEqual({
      message: m.account_directory_incomplete(),
      tone: 'warning',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 malformed'));
  });

  it('marks a wholly valid directory as complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, [{ id: 'only', name: 'Only Co', role: 'owner', ...grantFor('owner') }]),
      ),
    );

    await refreshCompanySummaries();

    expect(useStore.getState().companySummariesComplete).toBe(true);
  });
}

describe('refreshCompanySummaries — shared request ordering', () => {
  createOrderedRefreshTests();
  createMutationRefreshTests();
  createCompletenessRefreshTests();
});

function HookHost() {
  useCompanySummaries();
  return null;
}

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function createYieldingHookTest() {
  it('does not fetch the blocked company directory during an active masquerade', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useStore.setState({
      activeCompanyId: null,
      masquerade: {
        kind: 'active',
        generation: 1,
        state: {
          companyId: 'a1',
          targetUserId: 'target',
          targetName: 'Selina Kyle',
          effectiveRole: 'viewer',
          ...masqueradeGrantFor('viewer'),
          startedAt: '2026-09-01T10:00:00.000Z',
          expiresAt: '2999-09-01T10:15:00.000Z',
          token: 'session-token',
        },
      },
    });

    const view = renderWithQuery(<HookHost />);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it('publishes the directory to the store only, never to the query cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, [{ id: 'a1', name: 'Studio A', role: 'owner', ...grantFor('owner') }]),
      ),
    );
    useStore.setState({ activeCompanyId: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <HookHost />
      </QueryClientProvider>,
    );

    await vi.waitFor(() =>
      expect(useStore.getState().companySummaries.map(({ id }) => id)).toEqual(['a1']),
    );
    expect(client.getQueryCache().getAll()).toEqual([]);
    view.unmount();
  });

  it('yields active-account reads when the permission provider owns that generation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useStore.setState({ activeCompanyId: 'a1' });

    const view = renderWithQuery(<HookHost />);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });
}

function createMalformedHookTests() {
  it('store.companySummaries is preserved when /api/companies 200s with a non-array body', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const existing = [{ id: 'a1', name: 'Studio A', role: 'owner' as const }];
    useStore.getState().setCompanySummaries({ list: existing });
    let resolveFetch!: () => void;
    const done = new Promise<void>((r) => (resolveFetch = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // Signal after returning would race the .json() await inside the hook; queueMicrotask keeps
        // the resolution ordered behind the hook's own awaits closely enough for the flush below.
        queueMicrotask(resolveFetch);
        return json(200, { not: 'an array' });
      }),
    );
    renderWithQuery(<HookHost />);
    await act(async () => {
      await done;
      // One extra macrotask so the hook's `await fetchCompanySummaries()` continuation (json parse +
      // the null early-return) has run before we assert.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useStore.getState().companySummaries).toEqual(existing);
  });
}

function createMembershipHookTest() {
  it('store.companySummaries is preserved when /api/companies 200s with an all-malformed array ([null])', async () => {
    // An array with no valid rows is not evidence that the company directory is empty.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const existing = [{ id: 'a1', name: 'Studio A', role: 'owner' as const }];
    useStore.getState().setCompanySummaries({ list: existing });
    let resolveFetch!: () => void;
    const done = new Promise<void>((r) => (resolveFetch = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        queueMicrotask(resolveFetch);
        return json(200, [null]);
      }),
    );
    renderWithQuery(<HookHost />);
    await act(async () => {
      await done;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useStore.getState().companySummaries).toEqual(existing);
  });

  it('refetches account roles when membership projections are invalidated', async () => {
    let role: 'owner' | 'admin' = 'owner';
    const fetchMock = vi.fn(async () =>
      json(200, [{ id: 'a1', name: 'Studio A', role, ...grantFor(role) }]),
    );
    vi.stubGlobal('fetch', fetchMock);
    useStore.setState({ membershipRevision: 0 });
    renderWithQuery(<HookHost />);

    await act(async () => {
      await vi.waitFor(() => expect(useStore.getState().companySummaries[0]?.role).toBe('owner'));
    });
    role = 'admin';
    act(() => useStore.getState().invalidateMemberships());

    await act(async () => {
      await vi.waitFor(() => expect(useStore.getState().companySummaries[0]?.role).toBe('admin'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
}

describe('useCompanySummaries — a malformed 200 leaves the existing list alone', () => {
  createYieldingHookTest();
  createMalformedHookTests();
  createMembershipHookTest();
});
