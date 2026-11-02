import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the product auth client so the forms can submit without a real server. Its methods return
// a typed { data, error } result so each form sets its inline error
// and the per-control describedby wires up.
const signInEmail = vi.fn();
const requestPasswordReset = vi.fn();
vi.mock('./authClient', () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
    },
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
  },
}));

import { LoginScreen } from './LoginScreen';
import { m } from '@/i18n';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  signInEmail.mockReset();
  requestPasswordReset.mockReset();
});

function setsDescriptiveTitleOutsideAppShell() {
  document.title = 'Schedule · CapacityLens';

  render(<LoginScreen onSignedIn={vi.fn()} />);

  expect(document.title).toBe('Sign in · CapacityLens');
}

describe('LoginScreen — password sign-in', () => {
  it(
    'sets a descriptive title while rendering outside the app shell',
    setsDescriptiveTitleOutsideAppShell,
  );

  it('opens the app after a successful password sign-in without a local challenge', async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    const onSignedIn = vi.fn();
    render(<LoginScreen onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });

  it('keeps an oversized current password intact and refuses to send it', () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    const password = 'x'.repeat(257);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByLabelText('Password')).toHaveValue(password);
    expect(screen.getByRole('alert')).toHaveTextContent(m.login_password_input_too_long());
    expect(signInEmail).not.toHaveBeenCalled();
  });
});

describe('LoginScreen — per-control error cues (WCAG 3.3.1)', () => {
  it('surfaces a network error and re-enables sign in when the request throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    signInEmail.mockRejectedValue(new TypeError('offline'));
    render(<LoginScreen onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.login_network_error());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('surfaces the product API message for password sign-in rejection', async () => {
    signInEmail.mockResolvedValue({ data: null, error: { message: 'Invalid email or password.' } });
    render(<LoginScreen onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('normalizes a pasted sign-in email before authenticating', async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(<LoginScreen onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  Person@Example.COM  ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith({
        email: 'person@example.com',
        password: 'correct-password',
      }),
    );
  });

  it('gives the email/password inputs ids and no aria-describedby before any error', () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');

    expect(email).toHaveAttribute('id');
    expect(password).toHaveAttribute('id');

    expect(email).not.toHaveAttribute('aria-describedby');
    expect(password).not.toHaveAttribute('aria-describedby');
  });

  it('points both inputs at the error message via aria-describedby after a failed sign-in', async () => {
    signInEmail.mockResolvedValue({ error: { message: 'Invalid email or password.' } });
    render(<LoginScreen onSignedIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');
    const errorId = alert.getAttribute('id');
    expect(errorId).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', errorId);
      expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', errorId);
    });
  });
});

// Before the first company exists, the first identity arrives through the operator's setup link,
// so the sign-in screen only explains where to go and keeps ordinary sign-in available.
describe('LoginScreen — before company setup (needsSetup)', () => {
  it('points to the setup link and keeps the sign-in form', () => {
    render(<LoginScreen needsSetup onSignedIn={vi.fn()} />);
    expect(screen.getByTestId('login-setup-needed')).toHaveTextContent(
      m.login_setup_link_needed({ app: 'CapacityLens' }),
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows no setup notice by default', () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    expect(screen.queryByTestId('login-setup-needed')).not.toBeInTheDocument();
  });
});

describe('LoginScreen — degraded 401 body notice', () => {
  it('shows the non-terminal advisory above the form when degraded is true', () => {
    render(<LoginScreen degraded onSignedIn={vi.fn()} />);
    expect(
      screen.getByText(
        'Sign-in configuration could not be loaded. Try again shortly or contact your administrator.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/single sign-on|fallback/i)).not.toBeInTheDocument();

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders no advisory by default (a well-formed body)', () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    expect(
      screen.queryByText(/sign-in configuration could not be loaded/i),
    ).not.toBeInTheDocument();
  });
});

describe('LoginScreen — unsaved session-expiry notice', () => {
  it('surfaces the captured write loss without blocking sign-in', () => {
    render(<LoginScreen hadUnsavedChanges onSignedIn={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not be saved before your session expired/i,
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('does not claim loss for an ordinary signed-out boot', () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    expect(
      screen.queryByText(/could not be saved before your session expired/i),
    ).not.toBeInTheDocument();
  });
});

it('reveals email password recovery and shows a neutral confirmation', async () => {
  requestPasswordReset.mockResolvedValue({ data: { ok: true }, error: null });
  render(<LoginScreen passwordResetEmail onSignedIn={vi.fn()} />);
  expect(screen.queryByTestId('forgot-password-email')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('forgot-password'));
  fireEvent.change(screen.getByTestId('forgot-password-email'), {
    target: { value: 'bruce@example.test' },
  });
  fireEvent.click(screen.getByTestId('forgot-password-submit'));
  expect(await screen.findByTestId('forgot-password-confirmation')).toHaveTextContent(
    "If an account uses that address, we've emailed a reset link.",
  );
  expect(requestPasswordReset).toHaveBeenCalledWith('bruce@example.test');
});
