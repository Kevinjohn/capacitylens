import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("../data/apiConfig", () => ({ API_BASE: "https://app.example" }));
vi.mock("../data/requestTimeout", () => ({
  apiFetch: mocks.apiFetch,
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: vi.fn((signal?: AbortSignal) => signal),
}));
vi.mock("../auth/apiFetchReauth", () => ({ apiFetchReauth: vi.fn() }));

import { accountClient, bindStoredAccountCommandsToIdentity, clearStoredAccountCommands } from "./accountClient";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function commandHeadersAt(index: number): [commandId: string | null, idempotencyKey: string | null] {
  const init = mocks.apiFetch.mock.calls[index]?.[1];
  if (!init) throw new Error(`Expected request call ${index} to include init options.`);
  const headers = new Headers(init.headers);
  return [headers.get("x-account-command-id"), headers.get("idempotency-key")];
}

async function waitForRequests(count: number): Promise<void> {
  await vi.waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(count));
}

async function flushPromiseContinuations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const ok = () => new Response(null, { status: 201 });
const unknown = () => new Response(null, { status: 503 });
const createWorkspace = () => accountClient.createWorkspace({ name: "Wayne Enterprises" });

describe("implicit account command cohorts", () => {
  beforeEach(() => {
    clearStoredAccountCommands();
    sessionStorage.clear();
    mocks.apiFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["definitive first", 0, 1],
    ["unknown first", 1, 0],
  ] as const)("retains a shared command when concurrent siblings settle $0", async (_name, first, second) => {
    const requests = [deferred<Response>(), deferred<Response>()] as const;
    mocks.apiFetch.mockImplementationOnce(() => requests[0].promise).mockImplementationOnce(() => requests[1].promise);

    const siblings = [createWorkspace(), createWorkspace()];
    await waitForRequests(2);
    const shared = commandHeadersAt(0);
    expect(commandHeadersAt(1)).toEqual(shared);

    requests[first].resolve(first === 0 ? ok() : unknown());
    await flushPromiseContinuations();
    requests[second].resolve(second === 1 ? unknown() : ok());
    await Promise.all(siblings);

    mocks.apiFetch.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    await createWorkspace();
    expect(commandHeadersAt(2)).toEqual(shared);
    await createWorkspace();
    expect(commandHeadersAt(3)).not.toEqual(shared);
  });

  it("retains a three-request cohort when its middle sibling is unknown", async () => {
    const requests = [deferred<Response>(), deferred<Response>(), deferred<Response>()] as const;
    for (const request of requests) mocks.apiFetch.mockImplementationOnce(() => request.promise);

    const siblings = [createWorkspace(), createWorkspace(), createWorkspace()];
    await waitForRequests(3);
    const shared = commandHeadersAt(0);
    expect(commandHeadersAt(1)).toEqual(shared);
    expect(commandHeadersAt(2)).toEqual(shared);

    requests[0].resolve(ok());
    requests[1].resolve(unknown());
    requests[2].resolve(ok());
    await Promise.all(siblings);

    mocks.apiFetch.mockResolvedValueOnce(unknown());
    await createWorkspace();
    expect(commandHeadersAt(3)).toEqual(shared);
  });

  it("keeps overlapping operation keys independent", async () => {
    const uncertain = deferred<Response>();
    const definitive = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => uncertain.promise).mockImplementationOnce(() => definitive.promise);

    const uncertainCall = accountClient.createWorkspace({ name: "Wayne Enterprises" });
    await waitForRequests(1);
    const uncertainHeaders = commandHeadersAt(0);
    const definitiveCall = accountClient.createWorkspace({ name: "Daily Planet" });
    await waitForRequests(2);
    const definitiveHeaders = commandHeadersAt(1);
    expect(definitiveHeaders).not.toEqual(uncertainHeaders);

    uncertain.resolve(unknown());
    definitive.resolve(ok());
    await Promise.all([uncertainCall, definitiveCall]);

    mocks.apiFetch.mockResolvedValueOnce(unknown()).mockResolvedValueOnce(ok());
    await accountClient.createWorkspace({ name: "Wayne Enterprises" });
    expect(commandHeadersAt(2)).toEqual(uncertainHeaders);
    await accountClient.createWorkspace({ name: "Daily Planet" });
    expect(commandHeadersAt(3)).not.toEqual(definitiveHeaders);
  });

  it("clears an all-definitive cohort only after its last sibling settles", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const firstCall = createWorkspace();
    await waitForRequests(1);
    const secondCall = createWorkspace();
    await waitForRequests(2);
    const shared = commandHeadersAt(0);
    first.resolve(ok());
    await firstCall;

    const third = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => third.promise);
    const thirdCall = createWorkspace();
    await waitForRequests(3);
    expect(commandHeadersAt(2)).toEqual(shared);
    second.resolve(ok());
    third.resolve(ok());
    await Promise.all([secondCall, thirdCall]);

    mocks.apiFetch.mockResolvedValueOnce(ok());
    await createWorkspace();
    expect(commandHeadersAt(3)).not.toEqual(shared);
  });

  it("retains the cohort when a transport throws while a sibling succeeds", async () => {
    const success = deferred<Response>();
    const failure = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => success.promise).mockImplementationOnce(() => failure.promise);

    const successfulCall = createWorkspace();
    await waitForRequests(1);
    const failedCall = createWorkspace();
    await waitForRequests(2);
    const shared = commandHeadersAt(0);
    failure.reject(new TypeError("network unavailable"));
    await expect(failedCall).rejects.toThrow("network unavailable");
    success.resolve(ok());
    await successfulCall;

    mocks.apiFetch.mockResolvedValueOnce(unknown());
    await createWorkspace();
    expect(commandHeadersAt(2)).toEqual(shared);
  });

  it("does not let an earlier identity's completion clear the current identity's cohort", async () => {
    const identityA = deferred<Response>();
    const identityB = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => identityA.promise).mockImplementationOnce(() => identityB.promise);

    bindStoredAccountCommandsToIdentity("bruce-wayne");
    const callA = createWorkspace();
    await waitForRequests(1);
    const headersA = commandHeadersAt(0);
    bindStoredAccountCommandsToIdentity("clark-kent");
    const callB = createWorkspace();
    await waitForRequests(2);
    const headersB = commandHeadersAt(1);
    expect(headersB).not.toEqual(headersA);

    identityA.resolve(ok());
    await callA;
    identityB.resolve(unknown());
    await callB;

    mocks.apiFetch.mockResolvedValueOnce(unknown());
    await createWorkspace();
    expect(commandHeadersAt(2)).toEqual(headersB);
  });

  it("does not let an in-flight completion recreate state cleared during sign-out", async () => {
    const request = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => request.promise);
    bindStoredAccountCommandsToIdentity("bruce-wayne");
    const call = createWorkspace();
    await waitForRequests(1);

    clearStoredAccountCommands();
    request.resolve(ok());
    await call;

    mocks.apiFetch.mockResolvedValueOnce(ok());
    await createWorkspace();
    expect(commandHeadersAt(1)).not.toEqual(commandHeadersAt(0));
  });

  it("does not let a pre-sign-out completion clear a same-identity cohort created afterward", async () => {
    const stale = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => stale.promise);
    bindStoredAccountCommandsToIdentity("bruce-wayne");
    const staleCall = createWorkspace();
    await waitForRequests(1);

    clearStoredAccountCommands();
    bindStoredAccountCommandsToIdentity("bruce-wayne");

    const fresh = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => fresh.promise);
    const freshCall = createWorkspace();
    await waitForRequests(2);
    const freshHeaders = commandHeadersAt(1);

    stale.resolve(ok());
    await staleCall;

    mocks.apiFetch.mockResolvedValueOnce(ok());
    const thirdCall = createWorkspace();
    await waitForRequests(3);
    expect(commandHeadersAt(2)).toEqual(freshHeaders);

    fresh.resolve(ok());
    await Promise.all([freshCall, thirdCall]);
  });

  it("retains a mixed-outcome cohort in the memory fallback", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const definitive = deferred<Response>();
    const ambiguous = deferred<Response>();
    mocks.apiFetch.mockImplementationOnce(() => definitive.promise).mockImplementationOnce(() => ambiguous.promise);

    const siblings = [createWorkspace(), createWorkspace()];
    await waitForRequests(2);
    const shared = commandHeadersAt(0);
    definitive.resolve(ok());
    ambiguous.resolve(unknown());
    await Promise.all(siblings);

    mocks.apiFetch.mockResolvedValueOnce(unknown());
    await createWorkspace();
    expect(commandHeadersAt(2)).toEqual(shared);
  });
});
