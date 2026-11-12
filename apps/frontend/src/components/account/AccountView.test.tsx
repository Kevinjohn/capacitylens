import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/auth/authContext';
import type { AuthContextValue } from '@/auth/authContext';

vi.mock('@/components/settings/SecuritySection', () => ({
  SecuritySection: ({
    passwordOpen,
    deleteOpen,
  }: {
    passwordOpen: boolean;
    deleteOpen: boolean;
  }) => (
    <section>
      {passwordOpen
        ? 'Password dialog open'
        : deleteOpen
          ? 'Delete dialog open'
          : 'Personal security'}
    </section>
  ),
}));

import { AccountView } from './AccountView';

const signOut = vi.fn();
function auth(authMode: AuthContextValue['authMode']): AuthContextValue {
  return {
    authMode,
    user: { id: 'u1', name: 'Diana Prince', email: 'diana@example.test' },
    refreshAuth: async () => {},
    signOut,
  };
}

function renderAccount(mode: AuthContextValue['authMode']) {
  return render(
    <AuthContext.Provider value={auth(mode)}>
      <AccountView />
    </AuthContext.Provider>,
  );
}

describe('AccountView', () => {
  it('uses separate single-line table cells and reveals the full truncated email on focus', async () => {
    renderAccount('password-only');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Account' }).parentElement?.parentElement,
    ).toHaveClass('max-w-4xl');
    const row = screen.getByTestId('account-identity-row');
    expect(row).toHaveTextContent('Diana Prince');
    expect(row.querySelectorAll('td')).toHaveLength(4);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Avatar',
      'Name',
      'Email',
      'Actions',
    ]);
    expect(screen.getByRole('columnheader', { name: 'Avatar' }).firstElementChild).toHaveClass(
      'sr-only',
    );
    expect(row.querySelectorAll('td')[0]).not.toHaveTextContent('Diana Prince');
    expect(row.querySelectorAll('td')[1]).toHaveTextContent('Diana Prince');
    expect(row.querySelectorAll('td')[3]).toContainElement(
      screen.getByRole('button', { name: 'Change password' }),
    );
    expect(row.querySelectorAll('td')[3]).toContainElement(
      screen.getByRole('button', { name: 'Sign out' }),
    );
    expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('table')).toHaveClass('min-w-[41rem]');
    expect(screen.getByRole('table').querySelector('colgroup')).not.toBeInTheDocument();
    const email = screen.getByLabelText('diana@example.test');
    expect(email).toHaveAttribute('tabindex', '0');
    expect(email).toHaveClass('truncate');
    fireEvent.focus(email);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('diana@example.test');
    expect(screen.queryByText('Signed in')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('Password dialog open')).toBeInTheDocument();
  });

  it('opens the account deletion dialog from the identity row', () => {
    renderAccount('password-only');
    const actions = screen.getByTestId('account-identity-row').querySelectorAll('td')[3];
    const remove = screen.getByRole('button', { name: 'Delete account' });
    expect(actions).toContainElement(remove);
    fireEvent.click(remove);
    expect(screen.getByText('Delete dialog open')).toBeInTheDocument();
  });

  it('signs out immediately', () => {
    signOut.mockClear();
    renderAccount('password-only');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('shows email in its own cell when the displayed name falls back to email', () => {
    render(
      <AuthContext.Provider
        value={{ ...auth('password-only'), user: { id: 'u1', email: 'diana@example.test' } }}
      >
        <AccountView />
      </AuthContext.Provider>,
    );
    const cells = screen.getByTestId('account-identity-row').querySelectorAll('td');
    expect(cells[1]).toHaveTextContent('diana@example.test');
    expect(cells[2]).toHaveTextContent('diana@example.test');
    expect(screen.getByLabelText('diana@example.test')).toHaveClass('truncate');
  });
});
