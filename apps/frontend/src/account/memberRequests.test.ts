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
import { hasUnknownAccountOperationOutcome } from './operationOutcome';
import { invitationRequests } from './invitationRequests';
import { invitationSignupRequests } from './invitationSignupRequests';
import { masqueradeRequests } from '@/auth/masqueradeRequests';
import { memberRequests } from './memberRequests';
import { operation, expectOperation } from './accountOperationsTestKit';

function requestInitAt(
  calls: ReadonlyArray<Parameters<typeof mocks.fetchApi>>,
  index: number,
): RequestInit {
  const call = calls[index];
  if (!call?.[1]) {
    throw new Error(`Expected request call ${index} to include init options.`);
  }
  return call[1];
}

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
  it('routes member-resource operations with operation headers and ambiguous conflict handling', async () => {
    mocks.fetchApi.mockResolvedValueOnce(new Response('unreadable conflict', { status: 409 }));
    const link = await memberRequests.setMemberResourceLink(
      {
        companyId: 'company / one',
        principalId: 'person / one',
        resourceId: 'resource / one',
        expectedRevision: null,
      },
      operation,
    );

    expect(hasUnknownAccountOperationOutcome(link)).toBe(true);
    const [linkUrl, linkInit] = mocks.fetchApi.mock.calls[0] as unknown as [string, RequestInit];
    expect(linkUrl).toBe(
      '/api/companies/company%20%2F%20one/members/person%20%2F%20one/resource-link',
    );
    expectOperation(linkInit, 'PUT');
    expect(JSON.parse(String(linkInit.body))).toEqual({
      resourceId: 'resource / one',
      expectedRevision: null,
    });

    await memberRequests.clearMemberResourceLink(
      {
        companyId: 'company / one',
        principalId: 'person / one',
        expectedRevision: 'revision-1',
      },
      operation,
    );
    const [unlinkUrl, unlinkInit] = mocks.fetchApi.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(unlinkUrl).toBe(linkUrl);
    expectOperation(unlinkInit, 'DELETE');
    expect(JSON.parse(String(unlinkInit.body))).toEqual({ expectedRevision: 'revision-1' });
  });
  it('owns member, invitation preview, and signup routes', async () => {
    await memberRequests.listMembers('company / one');
    await invitationRequests.listInvitations('company / one');
    await masqueradeRequests.startMasquerade('company / one', { targetUserId: 'person / one' });
    await masqueradeRequests.masqueradeStatus();
    await masqueradeRequests.endMasquerade({ token: 'token-1', reason: 'explicit' });
    await invitationSignupRequests.previewInvitation('token / one');
    await invitationSignupRequests.signupWithInvitation('token / one', {
      name: 'New user',
      password: 'example-password',
    });

    const directoryUrls = mocks.fetchApi.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.endsWith('/members') || url.endsWith('/invites'));
    expect(directoryUrls).toEqual([
      '/api/companies/company%20%2F%20one/members',
      '/api/companies/company%20%2F%20one/invites',
    ]);
    const urls = mocks.fetchApi.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      '/api/companies/company%20%2F%20one/members',
      '/api/companies/company%20%2F%20one/invites',
      '/api/companies/company%20%2F%20one/masquerade',
      '/api/masquerade',
      '/api/masquerade',
      '/api/invites/token%20%2F%20one/preview',
      '/api/invites/token%20%2F%20one/signup',
    ]);
    expect(requestInitAt(mocks.fetchApi.mock.calls, 2)).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ targetUserId: 'person / one' }),
    });
    expect(requestInitAt(mocks.fetchApi.mock.calls, 3)).toEqual({ credentials: 'include' });
    expect(requestInitAt(mocks.fetchApi.mock.calls, 4)).toMatchObject({
      method: 'DELETE',
      credentials: 'include',
      body: JSON.stringify({ token: 'token-1', reason: 'explicit' }),
    });
    expect(requestInitAt(mocks.fetchApi.mock.calls, 6)).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'New user', password: 'example-password' }),
    });
  });
  it('sends one operation and bound proof to the typed ownership route', async () => {
    await memberRequests.transferOwnership({
      companyId: 'company / one',
      targetPrincipalId: 'person / one',
      confirmationId: 'proof-1',
      operation,
    });

    const [url, init] = mocks.fetchApi.mock.calls[0] ?? [];
    expect(url).toBe('/api/companies/company%20%2F%20one/ownership-transfer');
    expectOperation(init as RequestInit, 'POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      toUserId: 'person / one',
      confirmationId: 'proof-1',
    });
  });
});
