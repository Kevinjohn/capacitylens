import { describe, expect, it, vi } from 'vitest';
import { readAuthResponse } from './authResponse';

const signedIn = (body: Record<string, unknown>) =>
  new Response(
    JSON.stringify({
      authMode: 'password-only',
      user: { id: 'u1', email: 'clark.kent@wayne.test' },
      emailVerified: true,
      membershipRequired: false,
      ...body,
    }),
    { status: 200 },
  );

describe('readAuthResponse limited gates', () => {
  it('keeps an unmet invitation requirement for the access screen', async () => {
    const result = await readAuthResponse(
      signedIn({
        admission: {
          admitted: false,
          requirements: { invitation: { met: false }, approval: { met: true, status: 'approved' } },
        },
      }),
    );
    expect(result).toMatchObject({
      kind: 'pass',
      accessGate: 'admission',
      admission: { invitationMissing: true, domainRefused: false, approvalStatus: 'approved' },
    });
  });

  it('keeps a refused domain for the access screen', async () => {
    const result = await readAuthResponse(
      signedIn({
        admission: {
          admitted: false,
          requirements: { domain: { met: false, reason: 'not_allowed' } },
        },
      }),
    );
    expect(result).toMatchObject({ kind: 'pass', admission: { domainRefused: true } });
  });

  it.each([
    { admission: undefined },
    { admission: { admitted: true, requirements: {} }, membershipRequired: undefined },
    { admission: { admitted: true, requirements: {} }, emailVerified: 'yes' },
  ])('treats a missing or malformed gate as an invalid response (%o)', async (body) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readAuthResponse(signedIn(body))).toMatchObject({ kind: 'error' });
  });
});
