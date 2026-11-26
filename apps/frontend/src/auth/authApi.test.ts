import { afterEach, describe, expect, it, vi } from 'vitest';

import { authApi } from './authApi';
import { createRequestLog } from '@/test/fetchRequests';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('product auth api', () => {
  it("posts password sign-in with session credentials for the backend's same-site CSRF boundary", async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    let sent: Request | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      sent = new Request(input, init).clone();
      return Response.json({
        data: {
          user: { id: 'u1', name: 'Bruce Wayne', email: 'bruce@example.test', image: null },
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await authApi.signIn.email({
      email: 'bruce@example.test',
      password: 'correct horse',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    if (!sent) throw new Error('Expected captured request');
    const request = sent;
    expect(request.url).toBe(`${window.location.origin}/api/v1/auth/sign-in`);
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('include');
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(await request.json()).toEqual({
      email: 'bruce@example.test',
      password: 'correct horse',
    });
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.has('x-xsrf-token')).toBe(false);
    expect(result).toEqual({
      data: { user: { id: 'u1', name: 'Bruce Wayne', email: 'bruce@example.test', image: null } },
      error: null,
    });
  });

  it('preserves native fetch and abort failures before a response', async () => {
    for (const failure of [
      new TypeError('Network unavailable'),
      new DOMException('Aborted', 'AbortError'),
    ]) {
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(failure);
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        authApi.signIn.email({ email: 'clark@wayne.example', password: 'secret' }),
      ).rejects.toBe(failure);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it('keeps null success for malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('invalid json', { headers: { 'content-type': 'application/json' } }),
        ),
    );
    await expect(
      authApi.signIn.email({ email: 'clark@wayne.example', password: 'secret' }),
    ).resolves.toEqual({
      data: null,
      error: null,
    });
  });

  it('keeps null success for an empty successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(
      authApi.signIn.email({ email: 'clark@wayne.example', password: 'secret' }),
    ).resolves.toEqual({
      data: null,
      error: null,
    });
  });

  it('keeps null success when the sign-in response body stream rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('Body disconnected'));
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(
      authApi.signIn.email({ email: 'clark@wayne.example', password: 'secret' }),
    ).resolves.toEqual({
      data: null,
      error: null,
    });
  });

  it.each([401, 403, 503])(
    'keeps HTTP %s when its sign-in response body stream rejects',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('Body disconnected'));
              },
            }),
            { status, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );

      await expect(
        authApi.signIn.email({ email: 'clark@wayne.example', password: 'secret' }),
      ).resolves.toEqual({
        data: null,
        error: { message: `Authentication request failed (${status}).`, status },
      });
    },
  );

  it('reads a flat JSON refusal independently of the response content type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Sign-in refused.', code: 'REFUSED' }), {
          status: 403,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );

    await expect(
      authApi.signIn.email({ email: 'clark@wayne.example', password: 'secret' }),
    ).resolves.toEqual({
      data: null,
      error: { message: 'Sign-in refused.', code: 'REFUSED', status: 403 },
    });
  });

  it('maps flat API errors without losing status or code', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' },
            { status: 401 },
          ),
        ),
    );

    await expect(
      authApi.signIn.email({ email: 'x@example.test', password: 'wrong' }),
    ).resolves.toEqual({
      data: null,
      error: { message: 'Invalid email or password.', code: 'INVALID_CREDENTIALS', status: 401 },
    });
  });

  it('gives malformed error bodies a status-specific fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 503 })),
    );

    await expect(authApi.requestPasswordReset('bruce@example.test')).resolves.toEqual({
      data: null,
      error: { message: 'Authentication request failed (503).', status: 503 },
    });
  });

  it('uses native recovery, password-change, and sign-out routes', async () => {
    const requests = createRequestLog();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      requests.record(input, init);
      return Response.json({ data: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await authApi.requestPasswordReset('bruce@example.test');
    await authApi.resetPassword({ token: 'single-use-token', newPassword: 'new-password' });
    await authApi.changePassword({
      currentPassword: 'current-password',
      newPassword: 'new-password',
    });
    await authApi.signOut();

    const sent = await requests.read();
    expect(sent.map(({ path }) => path)).toEqual([
      '/api/v1/auth/request-reset',
      '/api/v1/auth/reset-password',
      '/api/v1/auth/change-password',
      '/api/v1/auth/sign-out',
    ]);
    expect(sent.map(({ method }) => method)).toEqual(['POST', 'POST', 'POST', 'POST']);
    expect(sent.map(({ body }) => JSON.parse(String(body)))).toEqual([
      { email: 'bruce@example.test' },
      { token: 'single-use-token', newPassword: 'new-password' },
      { currentPassword: 'current-password', newPassword: 'new-password' },
      {},
    ]);
  });
});

it('retains unknown HTTP codes and safe operation metadata', async () => {
  const decision = { admitted: false, requirements: { invitation: { met: false } } };
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: 'Follow-up failed', code: 'DEPENDENCY_FUTURE_CODE', committed: true, decision },
          { status: 503 },
        ),
      ),
  );
  await expect(
    authApi.signIn.email({ email: 'bruce@wayne.example', password: 'secret' }),
  ).resolves.toMatchObject({
    data: null,
    error: {
      status: 503,
      message: 'Follow-up failed',
      code: 'DEPENDENCY_FUTURE_CODE',
      committed: true,
      decision,
    },
  });
});
