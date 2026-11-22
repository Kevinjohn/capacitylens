import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<Response>>(),
  start: vi.fn<() => Promise<Response>>(),
  end: vi.fn<() => Promise<Response>>(),
}));

vi.mock('./masqueradeRequests', () => ({
  masqueradeRequests: {
    masqueradeStatus: mocks.status,
    startMasquerade: mocks.start,
    endMasquerade: mocks.end,
  },
}));

import { masqueradeApi } from './masqueradeApi';
import { masqueradeGrantFor } from '@/test/permissionGrants';

const state = {
  companyId: 'a-studio',
  targetUserId: 'u-viewer',
  targetName: 'Selina Kyle',
  effectiveRole: 'viewer',
  ...masqueradeGrantFor('viewer'),
  startedAt: '2026-09-01T10:00:00.000Z',
  expiresAt: '2026-09-01T10:15:00.000Z',
  token: 'token-1',
};
const activeStatus = {
  active: true,
  ...state,
  contextToken: state.token,
  principal: { id: 'u-actor', email: 'actor@example.test' },
};

// A 2xx answer arrives inside the `{ data }` envelope; a refusal is flat.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(status < 300 ? { data: body } : body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  mocks.status.mockReset();
  mocks.start.mockReset();
  mocks.end.mockReset();
});

describe('masqueradeApi', () => {
  it('decodes status transported by the account api', async () => {
    mocks.status.mockResolvedValue(json(activeStatus));

    await expect(masqueradeApi.status('a-studio')).resolves.toEqual(activeStatus);
    expect(mocks.status).toHaveBeenCalledWith('a-studio');
  });

  it('accepts the backend-selected company when a cold status request has no local account', async () => {
    mocks.status.mockResolvedValue(json(activeStatus));
    await expect(masqueradeApi.status()).resolves.toEqual(activeStatus);
    expect(mocks.status).toHaveBeenCalledWith(undefined);
  });

  it('surfaces server-authored errors for start, status, and end', async () => {
    mocks.start.mockResolvedValue(json({ error: 'Start denied.' }, 403));
    mocks.status.mockResolvedValue(json({ error: 'Status unavailable.' }, 503));
    mocks.end.mockResolvedValue(json({ error: 'End denied.' }, 403));

    await expect(masqueradeApi.start('a-studio', 'u-viewer')).rejects.toThrow('Start denied.');
    await expect(masqueradeApi.status()).rejects.toThrow('Status unavailable.');
    await expect(masqueradeApi.end('token-1', 'explicit')).rejects.toThrow('End denied.');
  });

  it('retains the existing fallback when the server error body is unusable', async () => {
    mocks.status.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(masqueradeApi.status()).rejects.toThrow(
      'View as member status could not be read (503).',
    );
  });

  it('surfaces a decoded error when a successful response has no valid masquerade state', async () => {
    mocks.start.mockResolvedValue(json({ error: 'Start state unavailable.' }));
    mocks.status.mockResolvedValue(json({ error: 'Status state unavailable.' }));

    await expect(masqueradeApi.start('a-studio', 'u-viewer')).rejects.toThrow(
      'Start state unavailable.',
    );
    await expect(masqueradeApi.status()).rejects.toThrow('Status state unavailable.');
  });

  it.each([
    ['an empty account id', { companyId: '' }],
    ['an empty target user id', { targetUserId: '' }],
    ['an empty token', { token: '' }],
    ['an invalid timestamp', { startedAt: '2026-02-30T10:00:00.000Z' }],
    ['no permission list', { permissions: undefined }],
    ['a non-string permission key', { permissions: [1] }],
    ['a non-boolean private-name flag', { canSeePrivateNames: 'no' }],
  ])('rejects active state with %s', async (_description, change) => {
    mocks.status.mockResolvedValue(json({ ...activeStatus, ...change }));

    await expect(masqueradeApi.status()).rejects.toThrow(
      'The server returned an invalid masquerade status.',
    );
  });

  it.each([
    ['missing state fields', {}],
    ['a non-string account id', { ...state, companyId: 1 }],
    ['an unsupported role', { ...state, effectiveRole: 'auditor' }],
  ])('rejects active state with %s', async (_description, malformedState) => {
    mocks.status.mockResolvedValue(
      json({
        active: true,
        ...malformedState,
        principal: activeStatus.principal,
      }),
    );

    await expect(masqueradeApi.status()).rejects.toThrow(
      'The server returned an invalid masquerade status.',
    );
  });

  it('rejects array response bodies for status and start', async () => {
    mocks.status.mockResolvedValue(json([]));
    mocks.start.mockResolvedValue(json([]));

    await expect(masqueradeApi.status()).rejects.toThrow(
      'The server returned an invalid masquerade status.',
    );
    await expect(masqueradeApi.start('a-studio', 'u-viewer')).rejects.toThrow(
      'The server returned an invalid masquerade state.',
    );
  });

  it('preserves an empty target name', async () => {
    mocks.status.mockResolvedValue(json({ ...activeStatus, targetName: '' }));

    await expect(masqueradeApi.status()).resolves.toEqual({ ...activeStatus, targetName: '' });
  });

  it('requires a current idle context token from inactive status', async () => {
    mocks.status.mockResolvedValue(json({ active: false, contextToken: 'idle-context' }));
    await expect(masqueradeApi.status()).resolves.toEqual({
      active: false,
      contextToken: 'idle-context',
    });

    mocks.status.mockResolvedValue(json({ active: false, contextToken: null }));
    await expect(masqueradeApi.status()).resolves.toEqual({ active: false, contextToken: null });

    mocks.status.mockResolvedValue(json({ active: false }));
    await expect(masqueradeApi.status()).rejects.toThrow(
      'The server returned an invalid masquerade status.',
    );
  });

  it.each([undefined, null, { id: 'u-actor' }, { id: '', email: 'actor@example.test' }])(
    'rejects an active status whose principal is %j',
    async (principal) => {
      mocks.status.mockResolvedValue(json({ ...activeStatus, principal }));
      await expect(masqueradeApi.status()).rejects.toThrow(
        'The server returned an invalid masquerade principal.',
      );
    },
  );

  it('rejects a status whose active context proof differs from the active mode token', async () => {
    mocks.status.mockResolvedValue(json({ ...activeStatus, contextToken: 'stale-context' }));
    await expect(masqueradeApi.status()).rejects.toThrow(
      'The server returned an invalid masquerade status.',
    );
  });
});
