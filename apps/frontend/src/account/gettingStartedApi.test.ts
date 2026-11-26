import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchApi = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock('@/data/requestTimeout', () => ({ fetchApi }));

import { gettingStartedApi } from './gettingStartedApi';

const steps = { person: true, client: true, project: false, activity: false, scheduled: false };

describe('getting-started account api', () => {
  beforeEach(() => {
    fetchApi.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('reads and dismisses the encoded company URL', async () => {
    const controller = new AbortController();
    fetchApi.mockResolvedValueOnce(Response.json({ data: { dismissed: false, steps } }));
    await expect(gettingStartedApi.read('company / one', controller.signal)).resolves.toEqual({
      dismissed: false,
      steps,
    });
    await gettingStartedApi.dismiss('company / one');
    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      '/api/v1/companies/company%20%2F%20one/getting-started',
      { credentials: 'include', signal: controller.signal },
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      '/api/v1/companies/company%20%2F%20one/getting-started',
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      },
    );
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
