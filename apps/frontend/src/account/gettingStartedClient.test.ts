import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock('@/data/apiConfig', () => ({ API_BASE: 'https://app.example' }));
vi.mock('@/data/requestTimeout', () => ({ apiFetch }));

import { gettingStartedClient } from './gettingStartedClient';

describe('getting-started account client', () => {
  beforeEach(() => {
    apiFetch.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('reads and dismisses the encoded company URL', async () => {
    const controller = new AbortController();
    await gettingStartedClient.read('company / one', controller.signal);
    await gettingStartedClient.dismiss('company / one');
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      'https://app.example/api/accounts/company%20%2F%20one/getting-started',
      { credentials: 'include', signal: controller.signal },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      'https://app.example/api/accounts/company%20%2F%20one/getting-started',
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      },
    );
  });
});
