import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  requestSignal: vi.fn((signal?: AbortSignal) => signal),
}));

vi.mock('@/data/requestTimeout', () => ({
  apiFetch: mocks.apiFetch,
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: mocks.requestSignal,
}));

import { admissionRequests } from './admissionRequests';

describe('admission list query', () => {
  it('encodes an opaque cursor once and preserves credentials and cancellation', async () => {
    const controller = new AbortController();
    await admissionRequests.listAdmissionRequests('pending', 'next+/=&?', controller.signal);
    const call = mocks.apiFetch.mock.calls.at(-1);
    if (!call) throw new Error('Expected admission read');
    const url = new URL(call[0], window.location.origin);
    expect(url.pathname).toBe('/api/admission/requests');
    expect(url.searchParams.get('status')).toBe('pending');
    expect(url.searchParams.get('cursor')).toBe('next+/=&?');
    expect(call[1]).toMatchObject({ credentials: 'include', signal: controller.signal });
  });
});
