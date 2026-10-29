import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { teamAccessClient } from '@/account/teamAccessClient';
import type { AdmissionRequest } from '@/account/teamAccessClient';
import { AdmissionRequestsPanel } from './AdmissionRequestsPanel';

const pendingRequest: AdmissionRequest = {
  userId: 'u1',
  email: 'diana.prince@example.com',
  requestedAt: null,
  invitedRole: 'viewer',
  approval: 'pending',
};

afterEach(() => vi.restoreAllMocks());

describe('AdmissionRequestsPanel read and refusal states', () => {
  it('shows loading until the read finishes, then allows a failed read to be retried', async () => {
    let finishRead!: (
      value: Awaited<ReturnType<typeof teamAccessClient.listAdmissionRequests>>,
    ) => void;
    const firstRead = new Promise<
      Awaited<ReturnType<typeof teamAccessClient.listAdmissionRequests>>
    >((resolve) => {
      finishRead = resolve;
    });
    const list = vi
      .spyOn(teamAccessClient, 'listAdmissionRequests')
      .mockReturnValueOnce(firstRead)
      .mockResolvedValueOnce({ kind: 'ok', status: 200, value: [pendingRequest] });

    render(<AdmissionRequestsPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByTestId('admission-requests')).toHaveAttribute('aria-busy', 'true');

    finishRead({ kind: 'rejected', status: 503, message: 'Unavailable' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('admission-request')).toHaveTextContent(pendingRequest.email);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('admission-requests')).toHaveAttribute('aria-busy', 'false');
  });

  it('shows a decision refusal and keeps the request available', async () => {
    const list = vi
      .spyOn(teamAccessClient, 'listAdmissionRequests')
      .mockResolvedValue({ kind: 'ok', status: 200, value: [pendingRequest] });
    const decide = vi
      .spyOn(teamAccessClient, 'decideAdmission')
      .mockResolvedValue({ kind: 'rejected', status: 403, message: 'Approval is unavailable.' });

    render(<AdmissionRequestsPanel />);
    await screen.findByTestId('admission-request');
    fireEvent.click(screen.getByTestId('admission-approve'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Approval is unavailable.');
    expect(screen.getByTestId('admission-request')).toHaveTextContent(pendingRequest.email);
    await waitFor(() => expect(screen.getByTestId('admission-approve')).toBeEnabled());
    expect(decide).toHaveBeenCalledWith('u1', 'approve');
    expect(list).toHaveBeenCalledTimes(2);
  });
});
