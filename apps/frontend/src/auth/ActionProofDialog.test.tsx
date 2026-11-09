import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m } from '@/i18n';
import { ActionProofDialog } from './ActionProofDialog';

const request = vi.hoisted(() => vi.fn());

vi.mock('@/api/queryClient', () => ({
  apiRouteUrl: () => '/api/auth/action-proof/password',
}));
vi.mock('@/data/requestTimeout', () => ({ apiFetch: (...args: unknown[]) => request(...args) }));

afterEach(() => request.mockReset());

function renderDialog(action: 'transfer-ownership' | 'import' | 'anonymise' = 'import') {
  const onConfirmed = vi.fn();
  render(
    <ActionProofDialog
      action={action}
      accountId="account-1"
      intent={{ revision: 4 }}
      onConfirmed={onConfirmed}
      onCancel={vi.fn()}
    />,
  );
  return onConfirmed;
}

describe('ActionProofDialog', () => {
  it('submits exactly once with Enter', async () => {
    request.mockResolvedValue(Response.json({ proofId: 'proof-1' }));
    const onConfirmed = renderDialog();
    const password = screen.getByLabelText(m.login_password());
    await userEvent.type(password, 'current-password');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(onConfirmed).toHaveBeenCalledWith('proof-1');
  });

  it('submits exactly once with the Continue button', async () => {
    request.mockResolvedValue(Response.json({ proofId: 'proof-2' }));
    const onConfirmed = renderDialog();
    fireEvent.change(screen.getByLabelText(m.login_password()), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByTestId('action-proof-confirm'));

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(onConfirmed).toHaveBeenCalledWith('proof-2');
  });

  it('ignores empty and pending submissions and uses neutral progress copy', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    request.mockImplementation(
      () => new Promise<Response>((resolve) => (resolveRequest = resolve)),
    );
    const onConfirmed = renderDialog('transfer-ownership');
    const form = screen.getByRole('dialog').querySelector('form');
    if (!form) throw new Error('Expected the action proof form.');

    fireEvent.submit(form);
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(m.login_password()), {
      target: { value: 'current-password' },
    });
    fireEvent.submit(form);
    expect(screen.getByRole('button', { name: m.reauth_confirming() })).toBeDisabled();
    fireEvent.submit(form);
    expect(request).toHaveBeenCalledOnce();
    resolveRequest?.(Response.json({ proofId: 'proof-3' }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('proof-3'));
  });

  it.each(['transfer-ownership', 'import', 'anonymise'] as const)(
    'uses neutral progress copy for %s',
    async (action) => {
      request.mockImplementation(() => new Promise<Response>(() => {}));
      renderDialog(action);
      fireEvent.change(screen.getByLabelText(m.login_password()), {
        target: { value: 'current-password' },
      });
      fireEvent.click(screen.getByTestId('action-proof-confirm'));

      expect(await screen.findByRole('button', { name: m.reauth_confirming() })).toBeDisabled();
      expect(screen.queryByText(m.ownership_transfer_working())).not.toBeInTheDocument();
    },
  );

  it('allows retry after a rejected confirmation', async () => {
    request
      .mockResolvedValueOnce(Response.json({ error: 'Rejected.' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ proofId: 'proof-retry' }));
    const onConfirmed = renderDialog();
    fireEvent.change(screen.getByLabelText(m.login_password()), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByTestId('action-proof-confirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rejected.');
    fireEvent.click(screen.getByTestId('action-proof-confirm'));

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(onConfirmed).toHaveBeenCalledWith('proof-retry');
  });
});
