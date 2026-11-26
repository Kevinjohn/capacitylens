import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = await vi.hoisted(async () => {
  const { createRequestLog } = await import('@/test/fetchRequests');
  return {
    requests: createRequestLog(),
    fetchApi: vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 }))),
    requestSignal: vi.fn((signal?: AbortSignal) => signal),
  };
});

vi.mock('@/data/requestTimeout', () => ({
  fetchApi: (input: RequestInfo | URL, init?: RequestInit) => {
    mocks.requests.record(input, init);
    return mocks.fetchApi(input, init);
  },
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: mocks.requestSignal,
}));

import { sessionRequests } from './sessionRequests';
import { announceAuditWarning, AUDIT_WARNING_EVENT } from '@/lib/auditWarning';

describe('browser account api', () => {
  beforeEach(() => {
    mocks.fetchApi
      .mockReset()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    mocks.requestSignal.mockClear();
    mocks.requests.clear();
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

    const sent = await mocks.requests.read();
    expect(sent.map(({ path, method, credentials }) => ({ path, method, credentials }))).toEqual([
      { path: '/api/v1/auth/me', method: 'GET', credentials: 'include' },
      { path: '/api/v1/companies', method: 'GET', credentials: 'include' },
    ]);
    controller.abort();
    expect(sent.map(({ signal }) => signal.aborted)).toEqual([true, true]);
  });
  it('surfaces an audit-degradation warning when fetchApi reports one for /api/v1/auth/me', async () => {
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
