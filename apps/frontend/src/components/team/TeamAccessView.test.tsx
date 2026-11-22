import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Role } from '@capacitylens/shared/domain/access';
import { PermissionContext } from '@/auth/permissionContext';
import { AuthContext } from '@/auth/authContext';
import type { AuthContextValue } from '@/auth/authContext';
import { teamAccessApi } from '@/account/teamAccessApi';
import type { AdmissionRequest } from '@/account/teamAccessApi';
import { TeamAccessView } from './TeamAccessView';
import { useStore } from '@/store/useStore';
import { permissionValue, masqueradeGrantFor } from '@/test/permissionGrants';

vi.mock('./MembersSection', () => ({
  MembersSection: () => <div data-testid="member-management">Member controls</div>,
}));
vi.mock('./OwnershipTransferCard', () => ({
  OwnershipTransferCard: () => <div data-testid="ownership-transfer-card">Ownership controls</div>,
}));

const auth = (userId = 'me'): AuthContextValue => ({
  user: { id: userId, email: 'me@example.com' },
  refreshAuth: async () => {},
  signOut: async () => {},
});

interface RenderViewOptions {
  role: Role | null;
  status?: 'not-applicable' | 'pending' | 'resolved' | 'unavailable';
  userId?: string;
}

function renderView({
  role,
  status = role ? 'resolved' : 'not-applicable',
  userId = 'me',
}: RenderViewOptions) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth(userId)}>
        <PermissionContext.Provider value={permissionValue(role, status)}>
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
  useStore.setState({ masquerade: { kind: 'inactive' } });
});

afterEach(() => vi.restoreAllMocks());

describe('TeamAccessView access presentation', () => {
  it('keeps the capability list collapsed until it is asked for', async () => {
    renderView({ role: 'viewer' });
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
    renderView({ role: null, status: 'unavailable' });

    expect(screen.getByTestId('current-access')).toHaveTextContent('Your access');
    expect(screen.getByTestId('current-access')).not.toHaveTextContent('Open access');
    expect(
      screen.queryByText(/Anyone who can reach this installation can view and edit/i),
    ).not.toBeInTheDocument();
  });

  it('shows every Viewer capability and keeps management understandable but unavailable', () => {
    renderView({ role: 'viewer' });
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

  it('lists capabilities from the grant, so viewing as an Editor shows editing as not allowed', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={auth()}>
          <PermissionContext.Provider
            value={{ role: 'editor', status: 'resolved', grant: masqueradeGrantFor('editor') }}
          >
            <TeamAccessView />
          </PermissionContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('current-access')).toHaveTextContent('Editor');
    showCapabilities();
    expect(screen.getByText('View the schedule').closest('li')).toHaveTextContent('Allowed:');
    expect(screen.getByText('Edit scheduling data').closest('li')).toHaveTextContent(
      'Not allowed:',
    );
  });

  it('summarises a view-as as read-only instead of describing the viewed role', () => {
    useStore.setState({
      masquerade: {
        kind: 'active',
        generation: 1,
        state: {
          companyId: 'a-studio',
          targetUserId: 'target-user',
          targetName: 'Kara Danvers',
          effectiveRole: 'admin',
          ...masqueradeGrantFor('admin'),
          startedAt: '2026-09-01T10:00:00.000Z',
          expiresAt: '2999-09-01T10:15:00.000Z',
          token: 'session-token',
        },
      },
    });
    render(
      <MemoryRouter>
        <AuthContext.Provider value={auth()}>
          <PermissionContext.Provider
            value={{ role: 'admin', status: 'resolved', grant: masqueradeGrantFor('admin') }}
          >
            <TeamAccessView />
          </PermissionContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    const card = screen.getByTestId('current-access');
    expect(card).toHaveTextContent('Admin');
    expect(card).toHaveTextContent('Masquerade is read-only.');
    expect(card).not.toHaveTextContent(/Can edit the schedule/);
    expect(
      screen.getByText('Invitations and membership changes are not available during a masquerade.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/An Owner or Admin manages invitations/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
  });
});

describe('TeamAccessView member management', () => {
  it('shows management controls to the single Owner', () => {
    renderView({ role: 'owner' });
    expect(screen.getByTestId('current-access')).toHaveTextContent('single Owner');
    expect(screen.getByTestId('member-management')).toBeInTheDocument();
    expect(screen.getByTestId('ownership-transfer-card')).toBeInTheDocument();
  });

  it('keeps ownership transfer available only to the real online Owner', () => {
    const admin = renderView({ role: 'admin' });
    expect(screen.queryByTestId('ownership-transfer-card')).toBeNull();
    admin.unmount();

    const owner = renderView({ role: 'owner' });
    expect(screen.getByTestId('ownership-transfer-card')).toBeInTheDocument();
    owner.unmount();
  });

  it.each([
    ['pending', 'Checking access'],
    ['unavailable', 'Access unavailable'],
  ] as const)(
    'does not present Viewer as authoritative while membership is %s',
    (status, label) => {
      renderView({ role: 'viewer', status });

      expect(screen.getByTestId('current-access')).toHaveTextContent(label);
      expect(screen.getByTestId('current-access')).not.toHaveTextContent('Viewer');
      expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
    },
  );

  it('unmounts member management while a membership recheck fails closed', () => {
    const view = renderView({ role: 'owner', status: 'resolved' });
    const controls = screen.getByTestId('member-management');
    expect(controls).toBeVisible();

    view.rerender(
      <MemoryRouter>
        <AuthContext.Provider value={auth('password-only')}>
          <PermissionContext.Provider value={permissionValue('viewer', 'pending')}>
            <TeamAccessView />
          </PermissionContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(controls).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-management')).not.toBeInTheDocument();
  });

  it.each(['user', 'company'] as const)(
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
        value: Awaited<ReturnType<typeof teamAccessApi.decideAdmission>>,
      ) => void;
      let failDecision!: (failure: Error) => void;
      const oldDecision = new Promise<Awaited<ReturnType<typeof teamAccessApi.decideAdmission>>>(
        (resolve, reject) => {
          finishDecision = resolve;
          failDecision = reject;
        },
      );
      const list = vi
        .spyOn(teamAccessApi, 'listAdmissionRequests')
        .mockResolvedValueOnce({ kind: 'ok', status: 200, value: [oldRequest] })
        .mockResolvedValue({ kind: 'ok', status: 200, value: [successorRequest] });
      const decide = vi
        .spyOn(teamAccessApi, 'decideAdmission')
        .mockReturnValueOnce(oldDecision)
        .mockResolvedValue({ kind: 'rejected', status: 403, message: 'Approval is unavailable.' });

      useStore.setState({ activeCompanyId: 'a-studio' });
      const view = renderView({ role: 'admin' });
      await screen.findByText(oldRequest.email);
      fireEvent.click(screen.getByTestId('admission-approve'));
      const listingCountBeforeContextChange = list.mock.calls.length;

      if (changedContext === 'user') {
        view.rerender(
          <MemoryRouter>
            <AuthContext.Provider value={auth('next-user')}>
              <PermissionContext.Provider value={permissionValue('admin', 'resolved')}>
                <TeamAccessView />
              </PermissionContext.Provider>
            </AuthContext.Provider>
          </MemoryRouter>,
        );
      } else {
        act(() => useStore.setState({ activeCompanyId: 'a-loft' }));
      }

      await waitFor(() => expect(list).toHaveBeenCalledTimes(listingCountBeforeContextChange + 1));
      const successorListingCount = listingCountBeforeContextChange + 1;
      expect(await screen.findByText(successorRequest.email)).toBeInTheDocument();

      await act(async () => {
        if (changedContext === 'user') {
          finishDecision({ kind: 'rejected', status: 403, message: 'Old user refusal.' });
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
