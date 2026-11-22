import { describe, it, expect, afterEach, vi } from 'vitest';
import { companySeed } from '@/test/companyExport';
import {
  fetchInactiveRecords,
  InactiveRecordsHttpError,
  InactiveRecordsShapeError,
} from './fetchInactiveRecords';

// The shared reader of the purge-gated `?includeInactive=1` admin endpoint. The component suites
// (DeleteCompanyDialog, ArchivedSection) prove each caller's surface; this proves the helper's own
// contract (the request shape, the typed errors and the pre-migrate structural gate) once,
// where both callers inherit it.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => ({ data: body }) }) as unknown as Response;

describe('fetchInactiveRecords', () => {
  it('requests a complete inactive set for the company with credentials', async () => {
    const body = companySeed('a-studio');
    const fetchMock = vi.fn(async () => ok(body));
    vi.stubGlobal('fetch', fetchMock);

    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const controller = new AbortController();
    const data = await fetchInactiveRecords('a-studio', controller.signal);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/state?companyId=a-studio&includeInactive=1');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(120_000);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);

    expect(data).toEqual(body);
  });

  it('throws InactiveRecordsHttpError carrying the status and the server `{ error }` sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Down for backup.' }, { status: 503 })),
    );
    const err = await fetchInactiveRecords('a1').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InactiveRecordsHttpError);
    expect((err as InactiveRecordsHttpError).status).toBe(503);
    expect((err as InactiveRecordsHttpError).serverMessage).toBe('Down for backup.');
  });

  it('throws InactiveRecordsHttpError with serverMessage undefined when the error body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not JSON', { status: 403 })),
    );
    const err = await fetchInactiveRecords('a1').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InactiveRecordsHttpError);
    expect((err as InactiveRecordsHttpError).status).toBe(403);
    expect((err as InactiveRecordsHttpError).serverMessage).toBeUndefined();
  });

  // A partial 200 must not be repaired into an apparently complete set.
  it('throws InactiveRecordsShapeError on a structurally incomplete 200 body', async () => {
    for (const body of [
      null,
      [],
      { definitely: 'not CapacityLens' },
      { companies: [{ id: 'a1' }] },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ok(body)),
      );
      await expect(fetchInactiveRecords('a1')).rejects.toBeInstanceOf(InactiveRecordsShapeError);
    }
  });

  it('lets an unexpected failure propagate instead of reporting a shape error', async () => {
    const fault = new TypeError('unexpected reader fault');
    const body = {
      get companies(): never {
        throw fault;
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(body)),
    );

    await expect(fetchInactiveRecords('a-studio')).rejects.toBe(fault);
  });

  it('refuses a response that holds more than the requested company', async () => {
    const body = companySeed('a-studio');
    const other = companySeed('a-loft').companies;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ ...body, companies: [...body.companies, ...other] })),
    );
    await expect(fetchInactiveRecords('a-studio')).rejects.toBeInstanceOf(
      InactiveRecordsShapeError,
    );
  });
});
