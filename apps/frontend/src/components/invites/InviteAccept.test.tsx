import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors';
import { accountClient } from '@/account/accountClient';
import { InviteAccept } from './InviteAccept';

vi.mock('@/data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}));

const preview = {
  email: 'clark.kent@wayne.test',
  accountName: 'Wayne Enterprises',
  role: 'editor',
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/invite/single-use-token']}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('InviteAccept outcomes', () => {
  it.each([429, 500])(
    'reports a %i preview as unavailable, not as an invalid invitation',
    async (status) => {
      vi.spyOn(accountClient, 'previewInvitation').mockResolvedValue(
        new Response(null, { status }),
      );
      renderPage();
      expect(await screen.findByTestId('invite-error')).toHaveTextContent(
        'Could not check this invitation right now',
      );
    },
  );

  it('reports a not-found preview as an invalid invitation', async () => {
    vi.spyOn(accountClient, 'previewInvitation').mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    renderPage();
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(
      'This invitation is invalid or has expired',
    );
  });

  it('sends the person to sign in when the sign-up answer is lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(accountClient, 'previewInvitation').mockResolvedValue(Response.json(preview));
    const signup = vi
      .spyOn(accountClient, 'signupWithInvitation')
      .mockRejectedValue(new TypeError('offline'));
    renderPage();
    fireEvent.change(await screen.findByTestId('invite-name'), { target: { value: 'Clark Kent' } });
    fireEvent.change(screen.getByTestId('invite-password'), {
      target: { value: 'invitation-password-2026' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));
    expect(await screen.findByTestId('invite-uncertain')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-password')).not.toBeInTheDocument();
    expect(signup).toHaveBeenCalledTimes(1);
  });

  it('keeps the form and shows existing-account guidance for EMAIL_REGISTERED', async () => {
    const registered = {
      error: 'An account already uses this email. Sign in instead.',
      code: 'EMAIL_REGISTERED',
    } satisfies ProductHttpErrorBody;
    vi.spyOn(accountClient, 'previewInvitation').mockResolvedValue(Response.json(preview));
    const signup = vi
      .spyOn(accountClient, 'signupWithInvitation')
      .mockResolvedValue(Response.json(registered, { status: 409 }));
    renderPage();
    fireEvent.change(await screen.findByTestId('invite-name'), { target: { value: 'Clark Kent' } });
    fireEvent.change(screen.getByTestId('invite-password'), {
      target: { value: 'invitation-password-2026' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));

    expect(
      await screen.findByText('An account already exists for this address. Sign in instead.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('invite-name')).toBeInTheDocument();
    expect(screen.getByTestId('invite-password')).toBeInTheDocument();
    expect(screen.getByTestId('invite-submit')).toBeEnabled();
    expect(screen.queryByTestId('invite-uncertain')).not.toBeInTheDocument();
    expect(signup).toHaveBeenCalledWith('single-use-token', {
      name: 'Clark Kent',
      password: 'invitation-password-2026',
    });
  });
});

it.each(['not json', JSON.stringify({ role: 'editor' })])(
  'reports an unreadable or malformed successful preview as unavailable',
  async (body) => {
    vi.spyOn(accountClient, 'previewInvitation').mockResolvedValue(
      new Response(body, { status: 200 }),
    );
    renderPage();
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(
      'Could not check this invitation right now',
    );
  },
);
