import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MasqueradeBootstrapStatus } from './masqueradeApi';
import { renderFreshProvider, makeMeResponse } from './AuthProviderTestKit';

const authBootstrapMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeBootstrapStatus>>(async () => ({
    active: false,
    contextToken: 'idle',
  })),
}));
vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: authBootstrapMocks.masqueradeStatus },
}));

afterEach(() => {
  authBootstrapMocks.masqueradeStatus
    .mockReset()
    .mockResolvedValue({ active: false, contextToken: 'idle' });
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthProvider — server mode', () => {
  it('a 401 replaces the app with the sign-in screen (password form)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(401, {})),
    );
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();

    expect(
      screen.queryByText(/sign-in configuration could not be loaded/i),
    ).not.toBeInTheDocument();
  });

  it('uses the password sign-in wall for an explicit password-mode 401', async () => {
    // A 401 always offers a way in, never a terminal 'invalid configuration' screen.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(401, {})),
    );
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(
      screen.queryByText('The authentication service returned an invalid configuration.'),
    ).not.toBeInTheDocument();
    // A JSON body is a trustworthy signal, so no degraded notice.
    expect(
      screen.queryByText(/sign-in configuration could not be loaded/i),
    ).not.toBeInTheDocument();
  });
  it('shows the password sign-in wall with a degraded notice for a non-JSON 401', async () => {
    // A proxy returning a plain-HTML 401 (or an empty body) must land on a usable sign-in form, not a
    // dead-end error screen with no way to authenticate.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>401</html>', { status: 401 })),
    );
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    // The body couldn't be trusted at all, so the sign-in wall says its configuration is a guess.
    expect(screen.getByText(/sign-in configuration could not be loaded/i)).toBeInTheDocument();
  });
  it('password invite routes render before sign-in so the token can onboard a new identity', async () => {
    window.history.pushState({}, '', '/invitation/invite-token');
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => makeMeResponse(401, {})),
      );
      const { AuthProvider } = await renderFreshProvider();
      render(
        <AuthProvider>
          <div>invite-page</div>
        </AuthProvider>,
      );
      expect(await screen.findByText('invite-page')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
  it('invite routes render before sign-in so the acceptance form keeps the token', async () => {
    window.history.pushState({}, '', '/invitation/invite-token');
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => makeMeResponse(401, {})),
      );
      const { AuthProvider } = await renderFreshProvider();
      render(
        <AuthProvider>
          <div>invite-page</div>
        </AuthProvider>,
      );
      expect(await screen.findByText('invite-page')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
  it('a 401 with needsSetup:true explains the setup link above the sign-in form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(401, { needsSetup: true })),
    );
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByTestId('login-setup-needed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });
  it('fail-closed: junk/non-boolean needsSetup on the 401 body shows the ORDINARY sign-in form', async () => {
    // A proxy page or an off-spec server must never conjure a create-account form on a populated
    // instance: only a literal `true` counts.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(401, { needsSetup: 'yes' })),
    );
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });
});
