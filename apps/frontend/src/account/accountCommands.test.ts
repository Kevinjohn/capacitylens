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

import {
  bindStoredAccountCommandsToIdentity,
  clearStoredAccountCommands,
  createBrowserAccountCommand,
} from './accountCommands';
import { transferOwner } from './accountCommandsTestKit';

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

  it('creates independent command and idempotency secrets', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000000')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
    expect(createBrowserAccountCommand()).toEqual({
      commandId: '00000000-0000-4000-8000-000000000000',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    });
  });
  it('reuses an in-memory command when session storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000051')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000052')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000053')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000054');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await transferOwner({ name: 'Studio' });
    await transferOwner({ name: 'Studio' });
    await transferOwner({ name: 'Studio' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000051',
      '00000000-0000-4000-8000-000000000051',
      '00000000-0000-4000-8000-000000000053',
    ]);
  });
  it('clears retained command ceremonies without removing unrelated per-tab data', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000061')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000062')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000063')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000064');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    sessionStorage.setItem('capacitylens.unrelated-preference', 'keep');

    await transferOwner({ name: 'Shared browser' });
    clearStoredAccountCommands();
    await transferOwner({ name: 'Shared browser' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000061',
      '00000000-0000-4000-8000-000000000063',
    ]);
    expect(sessionStorage.getItem('capacitylens.unrelated-preference')).toBe('keep');
    expect(
      Array.from({ length: sessionStorage.length }, (_unused, index) => sessionStorage.key(index)),
    ).not.toContainEqual(expect.stringMatching(/^capacitylens\.account-command\./));
  });
  it('retains same-user recovery but clears a ceremony before a different identity can use it', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000081')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000082')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000083')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000084');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    bindStoredAccountCommandsToIdentity('user-one');
    await transferOwner({ name: 'Shared browser' });
    bindStoredAccountCommandsToIdentity('user-one');
    await transferOwner({ name: 'Shared browser' });
    bindStoredAccountCommandsToIdentity('user-two');
    await transferOwner({ name: 'Shared browser' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000081',
      '00000000-0000-4000-8000-000000000081',
      '00000000-0000-4000-8000-000000000083',
    ]);
    expect(sessionStorage.getItem('capacitylens.account-command.identity')).toBe('user-two');
  });
  it('isolates a surviving stored ceremony when identity-change cleanup cannot enumerate storage', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000091')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000092')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000093')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000094');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    bindStoredAccountCommandsToIdentity('user-one');
    await transferOwner({ name: 'Shared browser' });
    vi.spyOn(Storage.prototype, 'length', 'get').mockImplementationOnce(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    bindStoredAccountCommandsToIdentity('user-two');
    await transferOwner({ name: 'Shared browser' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000091',
      '00000000-0000-4000-8000-000000000093',
    ]);
  });
});
