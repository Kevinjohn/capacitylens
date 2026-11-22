import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { teamAccessApi } from '@/account/teamAccessApi';
import { useMemberInvites } from './useMemberInvites';

function renderInvites(email: string) {
  const fail = vi.fn();
  const setNotice = vi.fn();
  const { result } = renderHook(() => useMemberInvites());
  act(() => result.current.setInvitationPreauthorizedEmail(email));
  const submit = () =>
    result.current
      .createActions({
        clear: vi.fn(),
        requestCompanyId: () => 'account-1',
        isActiveCompany: () => true,
        withMemberAction: async (_key, body) => body('account-1'),
        fail,
        setNotice,
        reloadInvites: async () => {},
        reconcileUnknownMutation: async () => {},
      })
      .submitInvite();
  return { fail, setNotice, submit };
}

describe('useMemberInvites', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses an invitation without an address', async () => {
    const createInvitation = vi.spyOn(teamAccessApi, 'createInvitation');
    const { fail, submit } = renderInvites('  ');

    await act(async () => submit());

    expect(fail).toHaveBeenCalledWith('invite', "Enter the invitee's email address.");
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    [true, 'Invitation emailed to diana@example.com', undefined],
    [
      false,
      'The invitation was saved, but the email could not be sent. Use Resend to try again.',
      'warning',
    ],
  ])('says whether the invitation was emailed (%s)', async (emailed, notice, tone) => {
    const createInvitation = vi
      .spyOn(teamAccessApi, 'createInvitation')
      .mockResolvedValue({ kind: 'ok', status: emailed ? 201 : 202, value: { emailed } });
    const { setNotice, submit } = renderInvites(' diana@example.com ');

    await act(async () => submit());

    expect(createInvitation).toHaveBeenCalledWith({
      companyId: 'account-1',
      role: 'editor',
      email: 'diana@example.com',
    });
    expect(setNotice).toHaveBeenCalledWith(notice, ...(tone ? [tone] : []));
  });
});
