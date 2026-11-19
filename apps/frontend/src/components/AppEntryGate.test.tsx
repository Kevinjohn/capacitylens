import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
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
  activeCompanyId: 'a-studio',
  activeCompanyLoadFailed: null,
  activeCompanyName: 'Wayne Enterprises',
  onRetryActiveCompanyLoad: () => Promise.resolve(true),
  children: <div>application shell</div>,
};

describe('AppEntryGate', () => {
  it('shows only a neutral loading boundary before hydration completes', () => {
    render(<AppEntryGate {...baseProps} hydrated={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
  });

  it('focuses the retry action when a recovery stage appears', () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => {
      callback = next;
      return 17;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      render(<AppEntryGate {...baseProps} activeCompanyLoadFailed="a-studio" />);
      act(() => callback?.(0));

      expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it('cancels a stale stage focus frame when the application mounts', () => {
    const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(23);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      const view = render(<AppEntryGate {...baseProps} activeCompanyLoadFailed="a-studio" />);
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

  it('shows account-directory ambiguity even on the personal Account route', async () => {
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

  it('shows production account recovery without a company chooser, including on the Account route', async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue(true);
    render(
      <AppEntryGate
        {...baseProps}
        allowWithoutActiveCompany
        activeCompanyLoadFailed="a-studio"
        onRetryActiveCompanyLoad={retry}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Wayne Enterprises could not be opened' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Choose another company' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows an inline notice when a retry from account recovery fails', async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue(false);
    render(
      <AppEntryGate
        {...baseProps}
        allowWithoutActiveCompany
        activeCompanyLoadFailed="a-studio"
        onRetryActiveCompanyLoad={retry}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Retry failed');
  });

  it('does not show account recovery for a null or non-matching failure', () => {
    const view = render(<AppEntryGate {...baseProps} activeCompanyLoadFailed={null} />);
    expect(screen.getByText('application shell')).toBeInTheDocument();

    view.rerender(<AppEntryGate {...baseProps} activeCompanyLoadFailed="a-loft" />);
    expect(screen.getByText('application shell')).toBeInTheDocument();
  });
});
