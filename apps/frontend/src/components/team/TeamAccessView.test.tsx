import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@capacitylens/shared/domain/access';
import { PermissionContext } from '@/auth/permissionContext';
import { AuthContext } from '@/auth/authContext';
import type { AuthContextValue } from '@/auth/authContext';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { AdmissionRequest } from '@/account/teamAccessClient';
import { TeamAccessView } from './TeamAccessView';
import { useStore } from '@/store/useStore';

const buildMode = vi.hoisted(() => ({ demo: false }));
vi.mock('@/data/apiConfig', () => ({
  isServerConfigured: () => true,
  isDemoMode: () => buildMode.demo,
  API_BASE: 'http://api.test',
}));

vi.mock('./MembersSection', () => ({
  MembersSection: () => <div data-testid="member-management">Member controls</div>,
}));
vi.mock('./OwnershipTransferCard', () => ({
  OwnershipTransferCard: () => <div data-testid="ownership-transfer-card">Ownership controls</div>,
}));

const auth = (authMode: AuthContextValue['authMode'], userId = 'me'): AuthContextValue => ({
  authMode,
  user: authMode === 'off' ? null : { id: userId, email: 'me@example.com' },
  canCreateAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
});

interface RenderViewOptions {
  role: Role | null;
  authMode: AuthContextValue['authMode'];
  status?: 'not-applicable' | 'pending' | 'resolved' | 'unavailable';
  userId?: string;
}

function renderView({
  role,
  authMode,
  status = role ? 'resolved' : 'not-applicable',
  userId = 'me',
}: RenderViewOptions) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth(authMode, userId)}>
        <PermissionContext.Provider value={{ role, status }}>
          <TeamAccessView />
        </PermissionContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function showCapabilities(): void {
  fireEvent.click(screen.getByTestId('capabilities-toggle'));
}

beforeEach(() => {
  buildMode.demo = false;
  useStore.setState({ masquerade: { kind: 'inactive' } });
});

afterEach(() => vi.restoreAllMocks());

describe('TeamAccessView access presentation', () => {
  it('labels the demo honestly and says why there is no membership directory', () => {
    buildMode.demo = true;
    renderView({ role: null, authMode: 'off' });
    expect(screen.getByTestId('current-access')).toHaveTextContent('Demo access');
    expect(screen.getByText(/not a real company membership/)).toBeInTheDocument();
    expect(screen.getByText(/people who sign in, not the resources/i)).toBeInTheDocument();
    expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
  });

  it('keeps the capability list collapsed until it is asked for', async () => {
    renderView({ role: 'viewer', authMode: 'password-only' });
    const toggle = screen.getByTestId('capabilities-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('View the schedule')).not.toBeInTheDocument();

    showCapabilities();
    expect(screen.getByTestId('capabilities-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('View the schedule')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('capabilities-toggle'));
    expect(screen.queryByText('View the schedule')).not.toBeInTheDocument();
  });

  it('does not present a persisted server as open access', () => {
    renderView({ role: null, authMode: 'off' });

    expect(screen.getByTestId('current-access')).toHaveTextContent('Your access');
    expect(screen.getByTestId('current-access')).not.toHaveTextContent('Open access');
    expect(
      screen.queryByText(/Anyone who can reach this installation can view and edit/i),
    ).not.toBeInTheDocument();
  });

  it('shows every Viewer capability and keeps management understandable but unavailable', () => {
    renderView({ role: 'viewer', authMode: 'password-only' });
    expect(screen.getByTestId('current-access')).toHaveTextContent('Viewer');
    showCapabilities();
    expect(screen.getByText('View the schedule')).toBeInTheDocument();
    expect(screen.getByText('Edit scheduling data')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('View the schedule').closest('li')).toHaveTextContent('Allowed:');
    expect(screen.getByText('Edit scheduling data').closest('li')).toHaveTextContent(
      'Not allowed:',
    );
    expect(screen.getByText(/An Owner or Admin manages invitations/)).toBeInTheDocument();
    expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
  });
});

describe('TeamAccessView member management', () => {
  it('shows management controls to the single Owner', () => {
    renderView({ role: 'owner', authMode: 'password-only' });
    expect(screen.getByTestId('current-access')).toHaveTextContent('single Owner');
    expect(screen.getByTestId('member-management')).toBeInTheDocument();
    expect(screen.getByTestId('ownership-transfer-card')).toBeInTheDocument();
  });

  it('keeps ownership transfer available only to the real online Owner', () => {
    const admin = renderView({ role: 'admin', authMode: 'password-only' });
    expect(screen.queryByTestId('ownership-transfer-card')).toBeNull();
    admin.unmount();

    const owner = renderView({ role: 'owner', authMode: 'password-only' });
    expect(screen.getByTestId('ownership-transfer-card')).toBeInTheDocument();
    owner.unmount();
  });

  it.each([
    ['pending', 'Checking access'],
    ['unavailable', 'Access unavailable'],
  ] as const)(
    'does not present Viewer as authoritative while membership is %s',
    (status, label) => {
      renderView({ role: 'viewer', authMode: 'password-only', status });

      expect(screen.getByTestId('current-access')).toHaveTextContent(label);
      expect(screen.getByTestId('current-access')).not.toHaveTextContent('Viewer');
      expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
    },
  );

  it('unmounts member management while a membership recheck fails closed', () => {
    const view = renderView({ role: 'owner', authMode: 'password-only', status: 'resolved' });
    const controls = screen.getByTestId('member-management');
    expect(controls).toBeVisible();

    view.rerender(
      <MemoryRouter>
        <AuthContext.Provider value={auth('password-only')}>
          <PermissionContext.Provider value={{ role: 'viewer', status: 'pending' }}>
            <TeamAccessView />
          </PermissionContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(controls).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
  });

  it.each(['principal', 'company'] as const)(
    'replaces admission requests when the %s context changes and ignores the old decision',
    async (changedContext) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const oldRequest: AdmissionRequest = {
        userId: 'u1',
        email: 'diana.prince@example.com',
        requestedAt: null,
        invitedRole: 'viewer',
        approval: 'pending',
      };
      const successorRequest: AdmissionRequest = {
        ...oldRequest,
        userId: 'u2',
        email: 'barbara.gordon@example.com',
      };
      let finishDecision!: (
        value: Awaited<ReturnType<typeof teamAccessClient.decideAdmission>>,
      ) => void;
      let failDecision!: (failure: Error) => void;
      const oldDecision = new Promise<Awaited<ReturnType<typeof teamAccessClient.decideAdmission>>>(
        (resolve, reject) => {
          finishDecision = resolve;
          failDecision = reject;
        },
      );
      const list = vi
        .spyOn(teamAccessClient, 'listAdmissionRequests')
        .mockResolvedValueOnce({ kind: 'ok', status: 200, value: [oldRequest] })
        .mockResolvedValue({ kind: 'ok', status: 200, value: [successorRequest] });
      const decide = vi
        .spyOn(teamAccessClient, 'decideAdmission')
        .mockReturnValueOnce(oldDecision)
        .mockResolvedValue({ kind: 'rejected', status: 403, message: 'Approval is unavailable.' });

      useStore.setState({ activeAccountId: 'a-studio' });
      const view = renderView({ role: 'admin', authMode: 'password-only' });
      await screen.findByText(oldRequest.email);
      fireEvent.click(screen.getByTestId('admission-approve'));
      const listingCountBeforeContextChange = list.mock.calls.length;

      if (changedContext === 'principal') {
        view.rerender(
          <MemoryRouter>
            <AuthContext.Provider value={auth('password-only', 'next-principal')}>
              <PermissionContext.Provider value={{ role: 'admin', status: 'resolved' }}>
                <TeamAccessView />
              </PermissionContext.Provider>
            </AuthContext.Provider>
          </MemoryRouter>,
        );
      } else {
        act(() => useStore.setState({ activeAccountId: 'a-loft' }));
      }

      await waitFor(() => expect(list).toHaveBeenCalledTimes(listingCountBeforeContextChange + 1));
      const successorListingCount = listingCountBeforeContextChange + 1;
      expect(await screen.findByText(successorRequest.email)).toBeInTheDocument();

      await act(async () => {
        if (changedContext === 'principal') {
          finishDecision({ kind: 'rejected', status: 403, message: 'Old principal refusal.' });
        } else {
          failDecision(new Error('Old company decision failed.'));
        }
      });

      expect(list).toHaveBeenCalledTimes(successorListingCount);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(warn).not.toHaveBeenCalled();
      expect(screen.getByText(successorRequest.email)).toBeInTheDocument();

      const decisionCountBeforeCurrentAction = decide.mock.calls.length;
      fireEvent.click(screen.getByTestId('admission-approve'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Approval is unavailable.');
      expect(decide).toHaveBeenCalledTimes(decisionCountBeforeCurrentAction + 1);
      expect(list).toHaveBeenCalledTimes(successorListingCount + 1);
    },
  );
});
