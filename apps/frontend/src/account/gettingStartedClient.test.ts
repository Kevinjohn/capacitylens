import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock('@/data/requestTimeout', () => ({ apiFetch }));

import { gettingStartedClient } from './gettingStartedClient';

describe('getting-started account client', () => {
  beforeEach(() => {
    apiFetch.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('reads and dismisses the encoded company URL', async () => {
    const controller = new AbortController();
    apiFetch.mockResolvedValueOnce(Response.json({ dismissed: false }));
    await expect(
      gettingStartedClient.readDismissed('company / one', controller.signal),
    ).resolves.toBe(false);
    await gettingStartedClient.dismiss('company / one');
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      '/api/accounts/company%20%2F%20one/getting-started',
      { credentials: 'include', signal: controller.signal },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      '/api/accounts/company%20%2F%20one/getting-started',
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
    await expect(gettingStartedClient.readDismissed('c-1')).rejects.toThrow('(503)');
    apiFetch.mockResolvedValueOnce(Response.json({ dismissed: 'yes' }));
    await expect(gettingStartedClient.readDismissed('c-1')).rejects.toThrow('invalid');
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(gettingStartedClient.dismiss('c-1')).rejects.toThrow('(403)');
  });
});
