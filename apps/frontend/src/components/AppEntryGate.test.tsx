import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEntryGate } from './AppEntryGate';
import { useStore } from '@/store/useStore';

beforeEach(() => {
  useStore.setState({
    companySummaries: [],
    companySummariesComplete: false,
    companySummariesAmbiguous: false,
  });
});

const baseProps = {
  hydrated: true,
  hasActiveCompany: true,
  ambiguousCompanyDirectory: false,
  allowWithoutActiveCompany: false,
  children: <div>application shell</div>,
};

describe('AppEntryGate', () => {
  it('shows only a neutral loading gate before hydration completes', () => {
    render(<AppEntryGate {...baseProps} hydrated={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
  });

  it('cancels a stale stage focus frame when the application mounts', () => {
    const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(23);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      const view = render(<AppEntryGate {...baseProps} ambiguousCompanyDirectory />);
      view.rerender(<AppEntryGate {...baseProps} />);

      expect(cancel).toHaveBeenCalledWith(23);
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it('allows the personal Account route without an active company', () => {
    render(<AppEntryGate {...baseProps} hasActiveCompany={false} allowWithoutActiveCompany />);

    expect(screen.getByText('application shell')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Choose a company' })).not.toBeInTheDocument();
  });

  it('shows company-directory ambiguity even on the personal Account route', async () => {
    useStore.getState().setCompanySummaries({
      list: [
        { id: 'a-studio', name: 'Wayne Enterprises', role: 'owner' },
        { id: 'a-loft', name: 'Stark Industries', role: 'viewer' },
      ],
    });
    render(
      <AppEntryGate
        {...baseProps}
        hasActiveCompany={false}
        allowWithoutActiveCompany
        ambiguousCompanyDirectory
      />,
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
  });
});
