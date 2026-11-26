import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = await vi.hoisted(async () => {
  const { createRequestLog } = await import('@/test/readAccountFetchCall');
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

import { invitationRequests } from './invitationRequests';
import { invitationSignUpRequests } from './invitationSignUpRequests';
import { masqueradeRequests } from '@/auth/masqueradeRequests';
import { memberRequests } from './memberRequests';
import type { SentRequest } from '@/test/readAccountFetchCall';

// The server mints the operation identity for a request that carries none, so the browser sends none.
function expectPlainRequest(sent: SentRequest | undefined, method: string): void {
  expect(sent?.method).toBe(method);
  expect(sent?.credentials).toBe('include');
  expect(sent?.headers.has('idempotency-key')).toBe(false);
  expect(sent?.headers.has('x-account-operation-id')).toBe(false);
}

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
  it('routes member-resource operations without operation headers', async () => {
    await memberRequests.setMemberResourceLink({
      companyId: 'company / one',
      userId: 'person / one',
      resourceId: 'resource / one',
      expectedRevision: null,
    });

    await memberRequests.clearMemberResourceLink({
      companyId: 'company / one',
      userId: 'person / one',
      expectedRevision: 'revision-1',
    });
    const [link, unlink] = await mocks.requests.read();
    expect(link?.path).toBe(
      '/api/v1/companies/company%20%2F%20one/members/person%20%2F%20one/resource-link',
    );
    expectPlainRequest(link, 'PUT');
    expect(JSON.parse(String(link?.body))).toEqual({
      resourceId: 'resource / one',
      expectedRevision: null,
    });

    expect(unlink?.path).toBe(link?.path);
    expectPlainRequest(unlink, 'DELETE');
    expect(JSON.parse(String(unlink?.body))).toEqual({ expectedRevision: 'revision-1' });
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

    const sent = await mocks.requests.read();
    const directoryUrls = sent
      .map(({ path }) => path)
      .filter((url) => url.endsWith('/members') || url.endsWith('/invitations'));
    expect(directoryUrls).toEqual([
      '/api/v1/companies/company%20%2F%20one/members',
      '/api/v1/companies/company%20%2F%20one/invitations',
    ]);
    const urls = sent.map(({ path }) => path);
    expect(urls).toEqual([
      '/api/v1/companies/company%20%2F%20one/members',
      '/api/v1/companies/company%20%2F%20one/invitations',
      '/api/v1/companies/company%20%2F%20one/masquerade',
      '/api/v1/masquerade',
      '/api/v1/masquerade',
      '/api/v1/invitations/token%20%2F%20one/preview',
      '/api/v1/invitations/token%20%2F%20one/sign-up',
    ]);
    expect(sent[2]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ targetUserId: 'person / one' }),
    });
    expect(sent[3]).toMatchObject({ method: 'GET', credentials: 'include', body: null });
    expect([...(sent[3]?.headers.keys() ?? [])]).toEqual([]);
    expect(sent[4]).toMatchObject({
      method: 'DELETE',
      credentials: 'include',
      body: JSON.stringify({ token: 'token-1', reason: 'explicit' }),
    });
    expect(sent[6]).toMatchObject({
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

    const [sent] = await mocks.requests.read();
    expect(sent?.path).toBe('/api/v1/companies/company%20%2F%20one/ownership-transfer');
    expectPlainRequest(sent, 'POST');
    expect(sent?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(sent?.body))).toEqual({
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

    const sent = await mocks.requests.read();
    expect(sent.map(({ path }) => path)).toEqual([
      '/api/v1/companies/company%20%2F%20one/members/person%20%2F%20one',
      '/api/v1/companies/company%20%2F%20one/members/person%20%2F%20one/status',
      '/api/v1/invitations',
      '/api/v1/companies/company%20%2F%20one/invitations/invite%20%2F%20one',
    ]);
    const methods = ['PATCH', 'PATCH', 'POST', 'DELETE'];
    methods.forEach((method, index) => expectPlainRequest(sent[index], method));
    expect(sent[0]?.body).toBe(JSON.stringify({ role: 'editor' }));
    expect(sent[1]?.body).toBe(JSON.stringify({ status: 'suspended' }));
    expect(JSON.parse(String(sent[2]?.body))).toEqual({
      companyId: 'company / one',
      role: 'viewer',
      email: 'selina@wayne.test',
    });
  });
});
