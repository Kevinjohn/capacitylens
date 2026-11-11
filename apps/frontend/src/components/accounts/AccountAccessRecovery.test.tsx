import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useStore } from '@/store/useStore';
import { loadPlanningData } from '@/test/fixtures';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { AccountAccessRecovery } from './AccountAccessRecovery';

describe('Account access recovery boundary', () => {
  beforeEach(() => {
    loadPlanningData(emptyAppData());
    useStore.getState().setAccountSummaries({ list: [] });
  });

  it('keeps loading while the company directory is unresolved', () => {
    useStore.getState().setAccountSummaries({
      list: [],
      requestId: useStore.getState().accountSummariesRequestId,
      complete: false,
    });

    render(<AccountAccessRecovery />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the installation error instead of offering a company picker for multiple memberships', () => {
    useStore.getState().setAccountSummaries({
      list: [
        { id: 'company-a', name: 'Wayne Enterprises', role: 'owner' },
        { id: 'company-b', name: 'Stark Industries', role: 'viewer' },
      ],
    });

    render(<AccountAccessRecovery />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This installation has more than one company. Contact your administrator to resolve it.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Wayne Enterprises')).not.toBeInTheDocument();
  });

  it('shows the server membership guidance if no company is available', () => {
    render(<AccountAccessRecovery />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ask an admin for an invite to join an existing company.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
