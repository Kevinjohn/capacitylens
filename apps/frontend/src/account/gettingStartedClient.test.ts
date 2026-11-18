import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock('@/data/requestTimeout', () => ({ apiFetch }));

import { gettingStartedClient } from './gettingStartedClient';

const steps = { person: true, client: true, project: false, activity: false, scheduled: false };

describe('getting-started account client', () => {
  beforeEach(() => {
    apiFetch.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('reads and dismisses the encoded company URL', async () => {
    const controller = new AbortController();
    apiFetch.mockResolvedValueOnce(Response.json({ dismissed: false, steps }));
    await expect(gettingStartedClient.read('company / one', controller.signal)).resolves.toEqual({
      dismissed: false,
      steps,
    });
    await gettingStartedClient.dismiss('company / one');
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      '/api/companies/company%20%2F%20one/getting-started',
      { credentials: 'include', signal: controller.signal },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      '/api/companies/company%20%2F%20one/getting-started',
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      },
    );
  });

  it('throws for a refused read, an off-spec body or a refused dismissal', async () => {
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(gettingStartedClient.read('c-1')).rejects.toThrow('(503)');
    apiFetch.mockResolvedValueOnce(Response.json({ dismissed: 'yes', steps }));
    await expect(gettingStartedClient.read('c-1')).rejects.toThrow('invalid');
    apiFetch.mockResolvedValueOnce(Response.json({ dismissed: false }));
    await expect(gettingStartedClient.read('c-1')).rejects.toThrow('invalid');
    apiFetch.mockResolvedValueOnce(
      Response.json({ dismissed: false, steps: { ...steps, scheduled: 'yes' } }),
    );
    await expect(gettingStartedClient.read('c-1')).rejects.toThrow('invalid');
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(gettingStartedClient.dismiss('c-1')).rejects.toThrow('(403)');
  });
});
