import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchApi, requests } = await vi.hoisted(async () => {
  const { createRequestLog } = await import('@/test/readAccountFetchCall');
  return {
    fetchApi: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
    requests: createRequestLog(),
  };
});
vi.mock('@/data/requestTimeout', () => ({
  fetchApi: (input: RequestInfo | URL, init?: RequestInit) => {
    requests.record(input, init);
    return fetchApi(input, init);
  },
}));

import { gettingStartedApi } from './gettingStartedApi';

const steps = { person: true, client: true, project: false, activity: false, scheduled: false };

describe('getting-started account api', () => {
  beforeEach(() => {
    fetchApi
      .mockReset()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    requests.clear();
  });

  it('reads and dismisses the encoded company URL', async () => {
    const controller = new AbortController();
    fetchApi.mockResolvedValueOnce(Response.json({ data: { dismissed: false, steps } }));
    await expect(gettingStartedApi.read('company / one', controller.signal)).resolves.toEqual({
      dismissed: false,
      steps,
    });
    await gettingStartedApi.dismiss('company / one');
    const [read, dismiss] = await requests.read();
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(read).toMatchObject({
      path: '/api/v1/companies/company%20%2F%20one/getting-started',
      method: 'GET',
      credentials: 'include',
      body: null,
    });
    expect(read?.signal.aborted).toBe(false);
    controller.abort();
    expect(read?.signal.aborted).toBe(true);
    expect(dismiss).toMatchObject({
      path: '/api/v1/companies/company%20%2F%20one/getting-started',
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ dismissed: true }),
    });
    expect(dismiss?.headers.get('content-type')).toBe('application/json');
  });

  it('throws for a refused read, an off-spec body or a refused dismissal', async () => {
    fetchApi.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(gettingStartedApi.read('c-1')).rejects.toThrow('(503)');
    fetchApi.mockResolvedValueOnce(Response.json({ data: { dismissed: 'yes', steps } }));
    await expect(gettingStartedApi.read('c-1')).rejects.toThrow('invalid');
    fetchApi.mockResolvedValueOnce(Response.json({ data: { dismissed: false } }));
    await expect(gettingStartedApi.read('c-1')).rejects.toThrow('invalid');
    fetchApi.mockResolvedValueOnce(
      Response.json({ data: { dismissed: false, steps: { ...steps, scheduled: 'yes' } } }),
    );
    await expect(gettingStartedApi.read('c-1')).rejects.toThrow('invalid');
    fetchApi.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(gettingStartedApi.dismiss('c-1')).rejects.toThrow('(403)');
  });
});
