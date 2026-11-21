import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock('@/data/requestTimeout', () => ({
  fetchApi: mocks.fetchApi,
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: vi.fn((signal?: AbortSignal) => signal),
  setMasqueradeEndedHandler: vi.fn(),
  setMasqueradeContextReader: vi.fn(),
}));

import { masqueradeModel } from '@/auth/masqueradeModelInstance';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  bindStoredAccountOperationsToIdentity,
  clearStoredAccountOperations,
} from './accountOperations';
import { invitationRequests } from './invitationRequests';
import { createDeferred } from '@/test/createDeferred';

function operationHeadersAt(
  index: number,
): [commandId: string | null, idempotencyKey: string | null] {
  const init = mocks.fetchApi.mock.calls[index]?.[1];
  if (!init) throw new Error(`Expected request call ${index} to include init options.`);
  const headers = new Headers(init.headers);
  return [headers.get('x-account-command-id'), headers.get('idempotency-key')];
}

async function waitForRequests(count: number): Promise<void> {
  await vi.waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(count));
}

async function flushPromiseContinuations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const ok = () => new Response(null, { status: 201 });
const unknown = () => new Response(null, { status: 503 });
const createInvitation = () =>
  invitationRequests.createInvitation({
    companyId: 'a-studio',
    role: 'viewer',
    email: 'selina@wayne.test',
  });

describe('implicit account operation cohorts', () => {
  beforeEach(() => {
    clearStoredAccountOperations();
    sessionStorage.clear();
    mocks.fetchApi.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    'keeps the original invitation action across deferred hashing (context changes: %s)',
    async (changed) => {
      setMasqueradeContextToken('idle-before');
      const original = crypto.subtle.digest.bind(crypto.subtle);
      const held = createDeferred<ArrayBuffer>();
      const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => held.promise);
      const body = { companyId: 'a-studio', role: 'viewer' as const, email: 'selina@wayne.test' };
      mocks.fetchApi.mockResolvedValueOnce(ok());
      const pending = invitationRequests.createInvitation(body);
      try {
        await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
        body.email = 'barbara@wayne.test';
        await masqueradeModel.adoptStatus({
          active: false,
          contextToken: changed ? 'idle-after' : 'idle-before',
        });
        const args = digest.mock.calls[0];
        if (!args) throw new Error('Expected payload digest');
        held.resolve(await original(...args));
        if (changed) {
          await expect(pending).resolves.toMatchObject({ status: 409 });
          expect(mocks.fetchApi).not.toHaveBeenCalled();
        } else {
          await expect(pending).resolves.toMatchObject({ status: 201 });
          expect(mocks.fetchApi).toHaveBeenCalledOnce();
          expect(JSON.parse(String(mocks.fetchApi.mock.calls[0]?.[1]?.body))).toEqual({
            companyId: 'a-studio',
            role: 'viewer',
            email: 'selina@wayne.test',
          });
        }
      } finally {
        held.resolve(new ArrayBuffer(0));
        await pending;
        setMasqueradeContextToken(null);
      }
    },
  );

  it.each([
    ['definitive first', 0, 1],
    ['unknown first', 1, 0],
  ] as const)(
    'retains a shared operation when concurrent siblings settle $0',
    async (_name, first, second) => {
      const requests = [createDeferred<Response>(), createDeferred<Response>()] as const;
      mocks.fetchApi
        .mockImplementationOnce(() => requests[0].promise)
        .mockImplementationOnce(() => requests[1].promise);

      const siblings = [createInvitation(), createInvitation()];
      await waitForRequests(2);
      const shared = operationHeadersAt(0);
      expect(operationHeadersAt(1)).toEqual(shared);

      requests[first].resolve(first === 0 ? ok() : unknown());
      await flushPromiseContinuations();
      requests[second].resolve(second === 1 ? unknown() : ok());
      await Promise.all(siblings);

      mocks.fetchApi.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
      await createInvitation();
      expect(operationHeadersAt(2)).toEqual(shared);
      await createInvitation();
      expect(operationHeadersAt(3)).not.toEqual(shared);
    },
  );

  it('retains a three-request cohort when its middle sibling is unknown', async () => {
    const requests = [
      createDeferred<Response>(),
      createDeferred<Response>(),
      createDeferred<Response>(),
    ] as const;
    for (const request of requests) mocks.fetchApi.mockImplementationOnce(() => request.promise);

    const siblings = [createInvitation(), createInvitation(), createInvitation()];
    await waitForRequests(3);
    const shared = operationHeadersAt(0);
    expect(operationHeadersAt(1)).toEqual(shared);
    expect(operationHeadersAt(2)).toEqual(shared);

    requests[0].resolve(ok());
    requests[1].resolve(unknown());
    requests[2].resolve(ok());
    await Promise.all(siblings);

    mocks.fetchApi.mockResolvedValueOnce(unknown());
    await createInvitation();
    expect(operationHeadersAt(3)).toEqual(shared);
  });

  it('keeps overlapping operation keys independent', async () => {
    const uncertain = createDeferred<Response>();
    const definitive = createDeferred<Response>();
    mocks.fetchApi
      .mockImplementationOnce(() => uncertain.promise)
      .mockImplementationOnce(() => definitive.promise);

    const uncertainCall = invitationRequests.createInvitation({
      companyId: 'a-studio',
      role: 'viewer',
      email: 'selina@wayne.test',
    });
    await waitForRequests(1);
    const uncertainHeaders = operationHeadersAt(0);
    const definitiveCall = invitationRequests.createInvitation({
      companyId: 'a-studio',
      role: 'editor',
      email: 'selina@wayne.test',
    });
    await waitForRequests(2);
    const definitiveHeaders = operationHeadersAt(1);
    expect(definitiveHeaders).not.toEqual(uncertainHeaders);

    uncertain.resolve(unknown());
    definitive.resolve(ok());
    await Promise.all([uncertainCall, definitiveCall]);

    mocks.fetchApi.mockResolvedValueOnce(unknown()).mockResolvedValueOnce(ok());
    await invitationRequests.createInvitation({
      companyId: 'a-studio',
      role: 'viewer',
      email: 'selina@wayne.test',
    });
    expect(operationHeadersAt(2)).toEqual(uncertainHeaders);
    await invitationRequests.createInvitation({
      companyId: 'a-studio',
      role: 'editor',
      email: 'selina@wayne.test',
    });
    expect(operationHeadersAt(3)).not.toEqual(definitiveHeaders);
  });

  it('clears an all-definitive cohort only after its last sibling settles', async () => {
    const first = createDeferred<Response>();
    const second = createDeferred<Response>();
    mocks.fetchApi
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const firstCall = createInvitation();
    await waitForRequests(1);
    const secondCall = createInvitation();
    await waitForRequests(2);
    const shared = operationHeadersAt(0);
    first.resolve(ok());
    await firstCall;

    const third = createDeferred<Response>();
    mocks.fetchApi.mockImplementationOnce(() => third.promise);
    const thirdCall = createInvitation();
    await waitForRequests(3);
    expect(operationHeadersAt(2)).toEqual(shared);
    second.resolve(ok());
    third.resolve(ok());
    await Promise.all([secondCall, thirdCall]);

    mocks.fetchApi.mockResolvedValueOnce(ok());
    await createInvitation();
    expect(operationHeadersAt(3)).not.toEqual(shared);
  });

  it('retains the cohort when a transport throws while a sibling succeeds', async () => {
    const success = createDeferred<Response>();
    const failure = createDeferred<Response>();
    mocks.fetchApi
      .mockImplementationOnce(() => success.promise)
      .mockImplementationOnce(() => failure.promise);

    const successfulCall = createInvitation();
    await waitForRequests(1);
    const failedCall = createInvitation();
    await waitForRequests(2);
    const shared = operationHeadersAt(0);
    failure.reject(new TypeError('network unavailable'));
    await expect(failedCall).rejects.toThrow('network unavailable');
    success.resolve(ok());
    await successfulCall;

    mocks.fetchApi.mockResolvedValueOnce(unknown());
    await createInvitation();
    expect(operationHeadersAt(2)).toEqual(shared);
  });

  it("does not let an earlier identity's completion clear the current identity's cohort", async () => {
    const identityA = createDeferred<Response>();
    const identityB = createDeferred<Response>();
    mocks.fetchApi
      .mockImplementationOnce(() => identityA.promise)
      .mockImplementationOnce(() => identityB.promise);

    bindStoredAccountOperationsToIdentity('bruce-wayne');
    const callA = createInvitation();
    await waitForRequests(1);
    const headersA = operationHeadersAt(0);
    bindStoredAccountOperationsToIdentity('clark-kent');
    const callB = createInvitation();
    await waitForRequests(2);
    const headersB = operationHeadersAt(1);
    expect(headersB).not.toEqual(headersA);

    identityA.resolve(ok());
    await callA;
    identityB.resolve(unknown());
    await callB;

    mocks.fetchApi.mockResolvedValueOnce(unknown());
    await createInvitation();
    expect(operationHeadersAt(2)).toEqual(headersB);
  });

  it('does not let an in-flight completion recreate state cleared during sign-out', async () => {
    const request = createDeferred<Response>();
    mocks.fetchApi.mockImplementationOnce(() => request.promise);
    bindStoredAccountOperationsToIdentity('bruce-wayne');
    const call = createInvitation();
    await waitForRequests(1);

    clearStoredAccountOperations();
    request.resolve(ok());
    await call;

    mocks.fetchApi.mockResolvedValueOnce(ok());
    await createInvitation();
    expect(operationHeadersAt(1)).not.toEqual(operationHeadersAt(0));
  });

  it('does not let a pre-sign-out completion clear a same-identity cohort created afterward', async () => {
    const stale = createDeferred<Response>();
    mocks.fetchApi.mockImplementationOnce(() => stale.promise);
    bindStoredAccountOperationsToIdentity('bruce-wayne');
    const staleCall = createInvitation();
    await waitForRequests(1);

    clearStoredAccountOperations();
    bindStoredAccountOperationsToIdentity('bruce-wayne');

    const fresh = createDeferred<Response>();
    mocks.fetchApi.mockImplementationOnce(() => fresh.promise);
    const freshCall = createInvitation();
    await waitForRequests(2);
    const freshHeaders = operationHeadersAt(1);

    stale.resolve(ok());
    await staleCall;

    mocks.fetchApi.mockResolvedValueOnce(ok());
    const thirdCall = createInvitation();
    await waitForRequests(3);
    expect(operationHeadersAt(2)).toEqual(freshHeaders);

    fresh.resolve(ok());
    await Promise.all([freshCall, thirdCall]);
  });

  it('retains a mixed-outcome cohort in the memory fallback', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    const definitive = createDeferred<Response>();
    const ambiguous = createDeferred<Response>();
    mocks.fetchApi
      .mockImplementationOnce(() => definitive.promise)
      .mockImplementationOnce(() => ambiguous.promise);

    const siblings = [createInvitation(), createInvitation()];
    await waitForRequests(2);
    const shared = operationHeadersAt(0);
    definitive.resolve(ok());
    ambiguous.resolve(unknown());
    await Promise.all(siblings);

    mocks.fetchApi.mockResolvedValueOnce(unknown());
    await createInvitation();
    expect(operationHeadersAt(2)).toEqual(shared);
  });
});
