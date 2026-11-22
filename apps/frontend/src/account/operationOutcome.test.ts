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

import { clearStoredAccountOperations } from './accountOperations';
import { readUnknownAccountOperationOutcome } from './operationOutcome';
import { invitationRequests } from './invitationRequests';

describe('browser account api', () => {
  beforeEach(() => {
    clearStoredAccountOperations();
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
  it('treats invitation field order as irrelevant when binding a semantic payload', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000021')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000022');
    mocks.fetchApi.mockResolvedValue(new Response(null, { status: 503 }));

    await invitationRequests.createInvitation({
      companyId: 'a-studio',
      role: 'viewer',
      email: 'bruce@example.test',
    });
    await invitationRequests.createInvitation({
      email: 'bruce@example.test',
      role: 'viewer',
      companyId: 'a-studio',
    });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-operation-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000021',
    ]);
  });
  it('classifies server and in-progress responses as unknown without consuming the body', async () => {
    const inProgress = Response.json(
      { code: 'COMMAND_IN_PROGRESS', error: 'Still running.' },
      { status: 409 },
    );
    await expect(readUnknownAccountOperationOutcome(inProgress)).resolves.toBe(true);
    await expect(inProgress.json()).resolves.toMatchObject({
      error: 'Still running.',
    });
    await expect(
      readUnknownAccountOperationOutcome(new Response(null, { status: 408 })),
    ).resolves.toBe(true);
    await expect(
      readUnknownAccountOperationOutcome(new Response(null, { status: 503 })),
    ).resolves.toBe(true);
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503 }),
      ),
    ).resolves.toBe(true);
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'MAIL_UNAVAILABLE' }, { status: 503 }),
      ),
    ).resolves.toBe(false);
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 }),
      ),
    ).resolves.toBe(false);
  });
  it.each(['INVITATION_USED', 'CONFLICT', 'AUTHORITY_CHANGED', 'IDEMPOTENCY_CONFLICT'])(
    'classifies the known terminal 409 code %s as final',
    async (code) => {
      await expect(
        readUnknownAccountOperationOutcome(Response.json({ code }, { status: 409 })),
      ).resolves.toBe(false);
    },
  );

  it('classifies unreadable and unrecognised 409 responses as unknown', async () => {
    const unreadable = {
      status: 409,
      clone: () => ({
        json: () => Promise.reject(new Error('response body disconnected')),
      }),
    } as unknown as Response;

    await expect(
      readUnknownAccountOperationOutcome(new Response('truncated', { status: 409 })),
    ).resolves.toBe(true);
    await expect(readUnknownAccountOperationOutcome(unreadable)).resolves.toBe(true);
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'FUTURE_CONFLICT_CODE' }, { status: 409 }),
      ),
    ).resolves.toBe(true);
  });
});
