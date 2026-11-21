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
import { invitationRequests } from './invitationRequests';
import { memberRequests } from './memberRequests';
import { command, transferOwner, expectCommand } from './accountCommandsTestKit';

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
  it('adds command headers, JSON encoding, safe path encoding, and bulk timeout policy', async () => {
    await transferOwner({ name: 'Studio' }, command);
    await memberRequests.changeMemberRole({
      companyId: 'company / one',
      principalId: 'person / one',
      role: 'editor',
      command,
    });
    await memberRequests.transferOwnership({
      companyId: 'company / one',
      targetPrincipalId: 'person / one',
      confirmationId: 'proof-1',
      command,
    });
    await invitationRequests.createInvitation(
      { companyId: 'company / one', role: 'viewer', email: 'selina@wayne.test' },
      command,
    );
    await invitationRequests.revokeInvitation('company / one', 'invite / one', command);

    const [createUrl, createInit] = mocks.fetchApi.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(createUrl).toBe('/api/companies/a-studio/ownership-transfer');
    expectCommand(createInit, 'POST');
    expect(new Headers(createInit.headers).get('content-type')).toBe('application/json');
    expect(createInit.body).toBe(JSON.stringify({ toUserId: 'Studio', confirmationId: 'proof-1' }));

    const urls = mocks.fetchApi.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(
      expect.arrayContaining([
        '/api/companies/company%20%2F%20one/members/person%20%2F%20one',
        '/api/companies/company%20%2F%20one/invites/invite%20%2F%20one',
      ]),
    );
  });

  it('reuses the same command and target after an uncertain response', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000201')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000202');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ fromUserId: 'bruce', toUserId: 'selina' }));
    const input = {
      companyId: 'wayne-enterprises',
      targetPrincipalId: 'selina',
      confirmationId: 'proof-1',
    };

    await memberRequests.transferOwnership(input);
    await memberRequests.transferOwnership(input);

    const headers = mocks.fetchApi.mock.calls.map((call) => new Headers(call[1]?.headers));
    expect(headers[0]?.get('x-account-command-id')).toBe('00000000-0000-4000-8000-000000000201');
    expect(headers[0]?.get('idempotency-key')).toBe('00000000-0000-4000-8000-000000000202');
    expect(headers[1]?.get('x-account-command-id')).toBe(headers[0]?.get('x-account-command-id'));
    expect(headers[1]?.get('idempotency-key')).toBe(headers[0]?.get('idempotency-key'));
  });
  it('reuses a stored command across unknown outcomes and rotates it after terminal completion', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
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
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    ]);
  });
  it('reuses a stored command after HTTP 408 until a terminal completion is known', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000071')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000072')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000073')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000074');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 408 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await transferOwner({ name: 'Timeout Studio' });
    await transferOwner({ name: 'Timeout Studio' });
    await transferOwner({ name: 'Timeout Studio' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000071',
      '00000000-0000-4000-8000-000000000071',
      '00000000-0000-4000-8000-000000000073',
    ]);
  });
  it('keeps a command after an in-progress conflict but clears it after an idempotency conflict', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000006');
    mocks.fetchApi
      .mockResolvedValueOnce(Response.json({ code: 'COMMAND_IN_PROGRESS' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await transferOwner({ name: 'Studio' });
    await transferOwner({ name: 'Studio' });
    await transferOwner({ name: 'Studio' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000005',
    ]);
  });
  it('keeps the same command identity after an unreadable 409 response', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000041')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000042')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000043')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000044');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response('truncated', { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await transferOwner({ name: 'Studio' });
    await transferOwner({ name: 'Studio' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000041',
      '00000000-0000-4000-8000-000000000041',
    ]);
  });
  it('does not let an explicit command discard an implicit unknown-outcome ceremony', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000031')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000032');
    mocks.fetchApi
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await transferOwner({ name: 'Studio' });
    await transferOwner({ name: 'Studio' }, command);
    await transferOwner({ name: 'Studio' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000031',
      command.commandId,
      '00000000-0000-4000-8000-000000000031',
    ]);
  });
  it('keeps unknown-outcome ceremonies separate for different ownership targets', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000011')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000012')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000013')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000014');
    mocks.fetchApi.mockResolvedValue(new Response(null, { status: 503 }));

    await transferOwner({ name: 'Studio A' });
    await transferOwner({ name: 'Studio B' });
    await transferOwner({ name: 'Studio A' });

    const commandIds = mocks.fetchApi.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-account-command-id'),
    );
    expect(commandIds).toEqual([
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000013',
      '00000000-0000-4000-8000-000000000011',
    ]);
  });
});
