import { afterEach, describe, expect, it, vi } from 'vitest';
import { invitationSignupRequests } from './invitationSignupRequests';
import { readInvitationPreview, signUpWithInvitation } from './invitationSignupClient';

afterEach(() => vi.restoreAllMocks());

describe('invitation sign-up client', () => {
  it.each([
    [Response.json({ email: 'diana@themyscira.example', role: 'editor' }), 'ok'],
    [Response.json({ email: 42 }), 'unavailable'],
    [new Response(null, { status: 400 }), 'invalid'],
    [new Response(null, { status: 404 }), 'invalid'],
    [new Response(null, { status: 503 }), 'unavailable'],
  ])('reads a preview answer as a typed result', async (response, kind) => {
    vi.spyOn(invitationSignupRequests, 'previewInvitation').mockResolvedValue(response);
    await expect(readInvitationPreview('token-1')).resolves.toMatchObject({ kind });
  });

  it.each([
    [new Response(null, { status: 202 }), { kind: 'signed-up' }],
    [new Response(null, { status: 502 }), { kind: 'uncertain' }],
    [Response.json({ code: 'INVALID_TOKEN' }, { status: 400 }), { kind: 'invalid-token' }],
    [Response.json({ code: 'EMAIL_REGISTERED' }, { status: 409 }), { kind: 'email-registered' }],
    [
      Response.json({ error: 'Name is too long.' }, { status: 422 }),
      { kind: 'refused', message: 'Name is too long.' },
    ],
  ])('reads a sign-up answer as a typed result', async (response, result) => {
    vi.spyOn(invitationSignupRequests, 'signupWithInvitation').mockResolvedValue(response);
    await expect(
      signUpWithInvitation('token-1', { name: 'Diana Prince', password: 'lasso-of-truth' }),
    ).resolves.toEqual(result);
  });
});
