import { afterEach, expect, it, vi } from 'vitest';
import { client } from './queryClient';
import { readProductHttpFailure } from './productHttpError';

afterEach(() => vi.unstubAllGlobals());

it('adapts real generated-client 400 failures without a phantom validation status', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: 'Invalid email', code: 'VALIDATION_ERROR' }, { status: 400 }),
      ),
  );
  const [, error] = await client
    .request('api.auth.sign-in', { body: { email: 'invalid', password: 'secret' } })
    .safe();
  const failure = readProductHttpFailure(error, 'Fallback');
  expect(failure).toEqual({
    status: 400,
    body: { error: 'Invalid email', code: 'VALIDATION_ERROR' },
  });
  if (!failure) throw new Error('Expected HTTP failure');
  // @ts-expect-error The HTTP adapter cannot claim a 422 validation response.
  const status: 422 = failure.status;
  // @ts-expect-error Unknown wire codes do not become known validation codes automatically.
  const code: 'VALIDATION_ERROR' = failure.body.code;
  expect([status, code]).toEqual([400, 'VALIDATION_ERROR']);
});

it('keeps native transport and generated network failures distinct from HTTP', async () => {
  const cause = new TypeError('Network unavailable');
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(cause));
  const [, error] = await client
    .request('api.auth.sign-in', { body: { email: 'bruce@wayne.example', password: 'secret' } })
    .safe();
  expect(error?.kind).toBe('network');
  expect(readProductHttpFailure(error, 'Fallback')).toBeNull();
  expect(readProductHttpFailure(cause, 'Fallback')).toBeNull();
});
