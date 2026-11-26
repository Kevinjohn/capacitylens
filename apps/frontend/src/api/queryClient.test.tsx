import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  clearQueryCacheForScopeChange,
  client,
  buildScopeQueryKey,
  requestApiResponse,
} from './queryClient';
import { API_BULK_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS } from '@/data/requestTimeout';

describe('same-origin API requests', () => {
  it('keeps API requests rooted when the browser is on a nested account route', async () => {
    let requestedUrl: string | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = input instanceof Request ? input.url : input.toString();
      return Response.json({ user: { id: 'bruce' } });
    });
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState(null, '', '/account/');

    try {
      await client.request('api.session.show', {});
      if (requestedUrl === undefined) throw new Error('API request did not reach fetch.');
      expect(new URL(requestedUrl).pathname).toBe('/api/v1/auth/me');
    } finally {
      vi.unstubAllGlobals();
      window.history.replaceState(null, '', '/');
    }
  });
  it('sends every request to the page origin even when an old API origin variable is set', async () => {
    vi.stubEnv('VITE_CAPACITYLENS_API', 'https://api.example.test');
    vi.resetModules();
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(input instanceof Request ? input.url : input.toString());
        return Response.json({ data: [] });
      }),
    );
    try {
      const fresh = await import('./queryClient');
      await fresh.requestApiResponse('api.session.show', {});
      await fresh.requestApiResponse('api.admission_requests.index', {
        query: { status: 'pending' },
      });
      expect(requested.map((url) => new URL(url).origin)).toEqual([
        window.location.origin,
        window.location.origin,
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
  it("preserves a generated request's caller abort signal at the timeout boundary", async () => {
    const caller = new AbortController();
    let forwardedSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        forwardedSignal = init?.signal;
        caller.abort();
        return Response.json({ user: { id: 'bruce' } });
      }),
    );
    try {
      await client.request('api.session.show', { signal: caller.signal });
      expect(forwardedSignal).toBeInstanceOf(AbortSignal);
      expect(forwardedSignal?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('requestApiResponse', () => {
  it('returns a refused response with its status and unread body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Not allowed.' }, { status: 403 })),
    );
    try {
      const response = await requestApiResponse('api.session.show', {});
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Not allowed.' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends the named route with its parameters, query and JSON body', async () => {
    const requests: { request: Request; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (input instanceof Request) requests.push({ request: input, body: await input.text() });
        return new Response(null, { status: 204 });
      }),
    );
    try {
      await requestApiResponse('api.members.update', {
        params: { companyId: 'wayne', userId: 'bruce' },
        body: { role: 'admin' },
      });
      await requestApiResponse('api.company_state.show', {
        query: { companyId: 'wayne', includeInactive: '1' },
      });
      const [update, state] = requests;
      expect(update?.request.method).toBe('PATCH');
      expect(new URL(update?.request.url ?? '').pathname).toBe(
        '/api/v1/companies/wayne/members/bruce',
      );
      expect(update?.request.headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(update?.body ?? '')).toEqual({ role: 'admin' });
      expect(new URL(state?.request.url ?? '').search).toBe('?companyId=wayne&includeInactive=1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('decodes the response body only once, when the caller reads it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { companyId: 'wayne' } })),
    );
    const decode = vi.spyOn(Response.prototype, 'json');
    try {
      const response = await requestApiResponse('api.session.show', {});
      expect(decode).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({ data: { companyId: 'wayne' } });
    } finally {
      decode.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('throws the native fetch failure when no response arrives', async () => {
    const failure = new TypeError('Failed to fetch');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw failure;
      }),
    );
    try {
      await expect(requestApiResponse('api.session.show', {})).rejects.toBe(failure);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('applies the requested deadline instead of the interactive one', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: {} })),
    );
    try {
      await requestApiResponse('api.session.show', {});
      await requestApiResponse('api.session.show', {}, API_BULK_TIMEOUT_MS);
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
        API_REQUEST_TIMEOUT_MS,
        API_BULK_TIMEOUT_MS,
      ]);
    } finally {
      timeout.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('account query cache scope', () => {
  it('partitions route keys by user, company, and masquerade generation', () => {
    expect(
      buildScopeQueryKey({ userId: 'bruce', companyId: 'wayne', masqueradeGeneration: 2 }, [
        'api.members.index',
        { params: { companyId: 'wayne' } },
      ] as const),
    ).toEqual([
      'capacitylens',
      'bruce',
      'wayne',
      2,
      'api.members.index',
      { params: { companyId: 'wayne' } },
    ]);
  });

  it.each([
    [
      'user',
      { userId: 'bruce', companyId: 'wayne', masqueradeGeneration: 0 },
      { userId: 'alfred', companyId: 'wayne', masqueradeGeneration: 0 },
    ],
    [
      'company',
      { userId: 'bruce', companyId: 'wayne', masqueradeGeneration: 0 },
      { userId: 'bruce', companyId: 'stark', masqueradeGeneration: 0 },
    ],
    [
      'masquerade generation',
      { userId: 'bruce', companyId: 'wayne', masqueradeGeneration: 1 },
      { userId: 'bruce', companyId: 'wayne', masqueradeGeneration: 2 },
    ],
  ])('clears data when the %s changes', (_label, previous, next) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['private'], { name: 'Wayne Enterprises' });

    expect(clearQueryCacheForScopeChange(queryClient, previous, next)).toBe(true);
    expect(queryClient.getQueryData(['private'])).toBeUndefined();
  });

  it('keeps cached data when the entire identity scope is unchanged', () => {
    const queryClient = new QueryClient();
    const scope = { userId: 'bruce', companyId: 'wayne', masqueradeGeneration: 1 } as const;
    queryClient.setQueryData(['private'], { name: 'Wayne Enterprises' });

    expect(clearQueryCacheForScopeChange(queryClient, scope, scope)).toBe(false);
    expect(queryClient.getQueryData(['private'])).toEqual({ name: 'Wayne Enterprises' });
  });
});

describe('QueryCacheLifecycle', () => {
  it('clears private results across user, company, and masquerade transitions', async () => {
    const { act, render } = await import('@testing-library/react');
    const { AuthContext } = await import('@/auth/authContext');
    const { useStore } = await import('@/store/useStore');
    const { QueryCacheLifecycle } = await import('./QueryCacheLifecycle');
    const cache = new QueryClient();
    const authValue = (id: string | null) => ({
      user: id ? { id } : null,
      refreshAuth: async () => {},
      signOut: async () => {},
    });
    useStore.setState({ activeCompanyId: null, masquerade: { kind: 'inactive' } });
    const tree = (userId: string | null) => (
      <AuthContext.Provider value={authValue(userId)}>
        <QueryCacheLifecycle cache={cache} />
      </AuthContext.Provider>
    );
    const { rerender, unmount } = render(tree('bruce'));
    const seed = () => cache.setQueryData(['private'], 'sensitive data');
    const expectCleared = () => expect(cache.getQueryData(['private'])).toBeUndefined();

    seed();
    rerender(tree('alfred'));
    expectCleared();

    seed();
    await act(async () => useStore.setState({ activeCompanyId: 'wayne' }));
    expectCleared();

    seed();
    await act(async () =>
      useStore.setState({
        masquerade: {
          kind: 'starting',
          pending: { companyId: 'wayne', targetUserId: 'target' },
          generation: 1,
        },
      }),
    );
    expectCleared();

    unmount();
    const remounted = render(tree('alfred'));
    seed();
    remounted.unmount();
    render(tree('bruce'));
    expectCleared();
    useStore.setState({ activeCompanyId: null, masquerade: { kind: 'inactive' } });
  });
});
