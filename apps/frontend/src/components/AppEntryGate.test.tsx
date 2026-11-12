import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEntryGate } from './AppEntryGate';
import { useStore } from '@/store/useStore';

beforeEach(() => {
  useStore.setState({
    accountSummaries: [],
    accountSummariesComplete: false,
    accountSummariesAmbiguous: false,
  });
});

const baseProps = {
  hydrated: true,
  connectionError: false,
  loadError: false,
  hasActiveAccount: true,
  ambiguousAccountDirectory: false,
  allowWithoutActiveAccount: false,
  activeAccountId: 'a-studio',
  activeAccountLoadFailed: null,
  activeAccountName: 'Wayne Enterprises',
  onRetryActiveAccountLoad: () => Promise.resolve(true),
  children: <div>application shell</div>,
};

describe('AppEntryGate connection failures', () => {
  it('shows only a neutral loading boundary before hydration completes', () => {
    render(<AppEntryGate {...baseProps} hydrated={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
  });

  it('gates the application on a connection error', () => {
    render(<AppEntryGate {...baseProps} connectionError />);

    expect(screen.getByRole('heading', { name: 'Can’t reach the server' })).toBeInTheDocument();
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
  });

  it('routes unreadable local data to recovery rather than the server retry loop', async () => {
    render(<AppEntryGate {...baseProps} loadError />);

    expect(
      await screen.findByRole('heading', { name: 'Stored data could not be read' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download raw copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset data' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Can’t reach the server' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('application shell')).not.toBeInTheDocument();
  });

  it('focuses the retry action when the connection-error stage appears', () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => {
      callback = next;
      return 17;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      render(<AppEntryGate {...baseProps} connectionError />);
      act(() => callback?.(0));

      expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it('cancels a stale stage focus frame when the application mounts', () => {
    const request = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(23);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    try {
      const view = render(<AppEntryGate {...baseProps} connectionError />);
      view.rerender(<AppEntryGate {...baseProps} />);

      expect(cancel).toHaveBeenCalledWith(23);
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it('allows the personal Account route without an active company', () => {
    render(<AppEntryGate {...baseProps} hasActiveAccount={false} allowWithoutActiveAccount />);

    expect(screen.getByText('application shell')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Choose a company' })).not.toBeInTheDocument();
  });

  it('shows account-directory ambiguity even on the personal Account route', async () => {
    useStore.getState().setAccountSummaries({
      list: [
        { id: 'a-studio', name: 'Wayne Enterprises', role: 'owner' },
        { id: 'a-loft', name: 'Stark Industries', role: 'viewer' },
      ],
    });
    render(
      <AppEntryGate
        {...baseProps}
        hasActiveAccount={false}
        allowWithoutActiveAccount
        ambiguousAccountDirectory
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
        allowWithoutActiveAccount
        activeAccountLoadFailed="a-studio"
        onRetryActiveAccountLoad={retry}
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
        allowWithoutActiveAccount
        activeAccountLoadFailed="a-studio"
        onRetryActiveAccountLoad={retry}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Retry failed');
  });

  it('does not show account recovery for a null or non-matching failure', () => {
    const view = render(<AppEntryGate {...baseProps} activeAccountLoadFailed={null} />);
    expect(screen.getByText('application shell')).toBeInTheDocument();

    view.rerender(<AppEntryGate {...baseProps} activeAccountLoadFailed="a-loft" />);
    expect(screen.getByText('application shell')).toBeInTheDocument();
  });
});
