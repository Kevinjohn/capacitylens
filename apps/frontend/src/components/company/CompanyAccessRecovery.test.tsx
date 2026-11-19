import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useStore } from '@/store/useStore';
import { loadPlanningData } from '@/test/fixtures';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { CompanyAccessRecovery } from './CompanyAccessRecovery';

describe('Account access recovery boundary', () => {
  beforeEach(() => {
    loadPlanningData(emptyAppData());
    useStore.getState().setCompanySummaries({ list: [] });
  });

  it('keeps loading while the company directory is unresolved', () => {
    useStore.getState().setCompanySummaries({
      list: [],
      requestId: useStore.getState().companySummariesRequestId,
      complete: false,
    });

    render(<CompanyAccessRecovery />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'shows multiple-membership ambiguity before loading (complete=%s)',
    (complete) => {
      useStore.getState().setCompanySummaries({
        list: [
          { id: 'company-a', name: 'Wayne Enterprises', role: 'owner' },
          { id: 'company-b', name: 'Stark Industries', role: 'viewer' },
        ],
        complete,
      });

      render(<CompanyAccessRecovery />);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This installation has more than one company. Contact your administrator to resolve it.',
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('Wayne Enterprises')).not.toBeInTheDocument();
    },
  );

  it('shows a server 409 ambiguity response even when its directory is incomplete', () => {
    useStore.getState().setCompanySummaries({ list: [], complete: false, ambiguous: true });
    render(<CompanyAccessRecovery />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This installation has more than one company. Contact your administrator to resolve it.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the server membership guidance if no company is available', () => {
    render(<CompanyAccessRecovery />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ask an admin for an invite to join an existing company.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
