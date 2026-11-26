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

import { invitationRequests } from './invitationRequests';
import { invitationSignUpRequests } from './invitationSignUpRequests';
import { masqueradeRequests } from '@/auth/masqueradeRequests';
import { memberRequests } from './memberRequests';

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

// The server mints the operation identity for a request that carries none, so the browser sends none.
function expectPlainRequest(init: RequestInit, method: string): void {
  expect(init.method).toBe(method);
  expect(init.credentials).toBe('include');
  const headers = new Headers(init.headers);
  expect(headers.has('idempotency-key')).toBe(false);
  expect(headers.has('x-account-operation-id')).toBe(false);
}

describe('browser account api', () => {
  beforeEach(() => {
    mocks.fetchApi
      .mockReset()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    mocks.requestSignal.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('routes member-resource operations without operation headers', async () => {
    await memberRequests.setMemberResourceLink({
      companyId: 'company / one',
      userId: 'person / one',
      resourceId: 'resource / one',
      expectedRevision: null,
    });

    const [linkUrl, linkInit] = mocks.fetchApi.mock.calls[0] as unknown as [string, RequestInit];
    expect(linkUrl).toBe(
      '/api/v1/companies/company%20%2F%20one/members/person%20%2F%20one/resource-link',
    );
    expectPlainRequest(linkInit, 'PUT');
    expect(JSON.parse(String(linkInit.body))).toEqual({
      resourceId: 'resource / one',
      expectedRevision: null,
    });

    await memberRequests.clearMemberResourceLink({
      companyId: 'company / one',
      userId: 'person / one',
      expectedRevision: 'revision-1',
    });
    const [unlinkUrl, unlinkInit] = mocks.fetchApi.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(unlinkUrl).toBe(linkUrl);
    expectPlainRequest(unlinkInit, 'DELETE');
    expect(JSON.parse(String(unlinkInit.body))).toEqual({ expectedRevision: 'revision-1' });
  });
  it('owns member, invitation preview, and sign-up routes', async () => {
    await memberRequests.listMembers('company / one');
    await invitationRequests.listInvitations('company / one');
    await masqueradeRequests.startMasquerade('company / one', { targetUserId: 'person / one' });
    await masqueradeRequests.masqueradeStatus();
    await masqueradeRequests.endMasquerade({ token: 'token-1', reason: 'explicit' });
    await invitationSignUpRequests.previewInvitation('token / one');
    await invitationSignUpRequests.signUpWithInvitation('token / one', {
      name: 'New user',
      password: 'example-password',
    });

    const directoryUrls = mocks.fetchApi.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.endsWith('/members') || url.endsWith('/invitations'));
    expect(directoryUrls).toEqual([
      '/api/v1/companies/company%20%2F%20one/members',
      '/api/v1/companies/company%20%2F%20one/invitations',
    ]);
    const urls = mocks.fetchApi.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      '/api/v1/companies/company%20%2F%20one/members',
      '/api/v1/companies/company%20%2F%20one/invitations',
      '/api/v1/companies/company%20%2F%20one/masquerade',
      '/api/v1/masquerade',
      '/api/v1/masquerade',
      '/api/v1/invitations/token%20%2F%20one/preview',
      '/api/v1/invitations/token%20%2F%20one/sign-up',
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
  it('sends the bound proof to the typed ownership route', async () => {
    await memberRequests.transferOwnership({
      companyId: 'company / one',
      targetUserId: 'person / one',
      confirmationId: 'proof-1',
    });

    const [url, init] = mocks.fetchApi.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/companies/company%20%2F%20one/ownership-transfer');
    expectPlainRequest(init as RequestInit, 'POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      toUserId: 'person / one',
      confirmationId: 'proof-1',
    });
  });
  it('routes role, status, invitation and revocation writes with safe path encoding', async () => {
    await memberRequests.changeMemberRole({
      companyId: 'company / one',
      userId: 'person / one',
      role: 'editor',
    });
    await memberRequests.changeMemberStatus({
      companyId: 'company / one',
      userId: 'person / one',
      status: 'suspended',
    });
    await invitationRequests.createInvitation({
      companyId: 'company / one',
      role: 'viewer',
      email: 'selina@wayne.test',
    });
    await invitationRequests.revokeInvitation('company / one', 'invite / one');

    expect(mocks.fetchApi.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/v1/companies/company%20%2F%20one/members/person%20%2F%20one',
      '/api/v1/companies/company%20%2F%20one/members/person%20%2F%20one/status',
      '/api/v1/invitations',
      '/api/v1/companies/company%20%2F%20one/invitations/invite%20%2F%20one',
    ]);
    const methods = ['PATCH', 'PATCH', 'POST', 'DELETE'];
    methods.forEach((method, index) =>
      expectPlainRequest(requestInitAt(mocks.fetchApi.mock.calls, index), method),
    );
    expect(requestInitAt(mocks.fetchApi.mock.calls, 0).body).toBe(
      JSON.stringify({ role: 'editor' }),
    );
    expect(requestInitAt(mocks.fetchApi.mock.calls, 1).body).toBe(
      JSON.stringify({ status: 'suspended' }),
    );
    expect(JSON.parse(String(requestInitAt(mocks.fetchApi.mock.calls, 2).body))).toEqual({
      companyId: 'company / one',
      role: 'viewer',
      email: 'selina@wayne.test',
    });
  });
});
