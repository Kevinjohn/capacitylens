import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchApi: vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  requestSignal: vi.fn((signal?: AbortSignal) => signal),
}));

vi.mock('@/data/requestTimeout', () => ({
  fetchApi: mocks.fetchApi,
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: mocks.requestSignal,
}));

import { clearStoredAccountCommands } from './accountCommands';
import { sessionRequests } from './sessionRequests';
import { announceAuditWarning, AUDIT_WARNING_EVENT } from '@/lib/auditWarning';

describe('browser account client', () => {
  beforeEach(() => {
    clearStoredAccountCommands();
    mocks.fetchApi
      .mockReset()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    mocks.requestSignal.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('owns unauthenticated status and company-list reads via fetchApi', async () => {
    // Routed through fetchApi (not raw fetch) so the audit-degradation header check that fetchApi
    // performs applies uniformly to these reads too.
    const controller = new AbortController();

    await sessionRequests.me(controller.signal);
    await sessionRequests.listCompanies(controller.signal);

    expect(mocks.fetchApi).toHaveBeenNthCalledWith(1, '/api/auth/me', {
      credentials: 'include',
      signal: controller.signal,
    });
    expect(mocks.fetchApi).toHaveBeenNthCalledWith(2, '/api/companies', {
      credentials: 'include',
      signal: controller.signal,
    });
  });
  it('surfaces an audit-degradation warning when fetchApi reports one for /api/auth/me', async () => {
    // Account reads use fetchApi so audit-degradation headers reach the shared warning surface. The mock preserves that header check.
    const warning = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warning);
    mocks.fetchApi.mockImplementation(async () => {
      const res = new Response('{}', {
        status: 200,
        headers: { 'x-capacitylens-audit-warning': 'true' },
      });
      if (res.headers.get('x-capacitylens-audit-warning') === 'true') announceAuditWarning();
      return res;
    });

    try {
      await sessionRequests.me();
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, warning);
    }
  });
});
