import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('does not refresh after a pending decision settles after unmount', async () => {
    let finishDecision!: (
      value: Awaited<ReturnType<typeof teamAccessClient.decideAdmission>>,
    ) => void;
    const decision = new Promise<Awaited<ReturnType<typeof teamAccessClient.decideAdmission>>>(
      (resolve) => {
        finishDecision = resolve;
      },
    );
    const list = vi
      .spyOn(teamAccessClient, 'listAdmissionRequests')
      .mockResolvedValue({ kind: 'ok', status: 200, value: [pendingRequest] });
    vi.spyOn(teamAccessClient, 'decideAdmission').mockReturnValueOnce(decision);

    const view = render(<AdmissionRequestsPanel />);
    await screen.findByTestId('admission-request');
    fireEvent.click(screen.getByTestId('admission-approve'));
    view.unmount();

    await act(async () => {
      finishDecision({ kind: 'rejected', status: 403, message: 'Approval is unavailable.' });
    });

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight refresh and stops the actual paginated client before its next page', async () => {
    let resolveRefreshPage!: (response: Response) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshPage = new Promise<Response>((resolve) => {
      resolveRefreshPage = resolve;
    });
    const calls: { status: string; cursor: string | null; signal: AbortSignal | null }[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://api.test');
      if (init?.method === 'POST') return new Response(null, { status: 204 });

      const status = url.searchParams.get('status') ?? '';
      const cursor = url.searchParams.get('cursor');
      calls.push({ status, cursor, signal: init?.signal as AbortSignal | null });
      if (
        status === 'pending' &&
        cursor === null &&
        calls.filter((call) => call.status === 'pending').length === 2
      ) {
        markRefreshStarted();
        return refreshPage;
      }
      if (status === 'pending') {
        return Response.json({
          items: [
            {
              userId: 'u1',
              email: pendingRequest.email,
              requestedAt: null,
              invitation: { role: 'viewer' },
            },
          ],
          nextCursor: null,
        });
      }
      return Response.json({ items: [], nextCursor: null });
    });

    const view = render(<AdmissionRequestsPanel />);
    await screen.findByTestId('admission-request');
    fireEvent.click(screen.getByTestId('admission-approve'));
    await refreshStarted;
    const refreshSignal = calls.at(-1)?.signal;
    expect(refreshSignal).toBeTruthy();

    view.unmount();
    expect(refreshSignal?.aborted).toBe(true);

    await act(async () => {
      resolveRefreshPage(Response.json({ items: [], nextCursor: 'next-page' }));
      await refreshPage;
    });

    expect(calls.some((call) => call.cursor === 'next-page')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
