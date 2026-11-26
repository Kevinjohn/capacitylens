import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GettingStarted } from './GettingStarted';
import { resetStoreWithCompany } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { PermissionContext } from '@/auth/permissionContext';
import type { Role } from '@capacitylens/shared/domain/access';
import { permissionValue, masqueradeGrantFor } from '@/test/permissionGrants';
import { createRequestLog, readRequestTarget } from '@/test/readAccountFetchCall';

const NO_STEPS = {
  person: false,
  client: false,
  project: false,
  activity: false,
  scheduled: false,
};

/** The getting-started read body: dismissal plus the milestones the server reports. */
function readReply(dismissed: boolean, steps: Partial<typeof NO_STEPS> = {}) {
  return JSON.stringify({ data: { dismissed, steps: { ...NO_STEPS, ...steps } } });
}

const tourMock = vi.hoisted(() => ({ startTour: vi.fn<() => Promise<void>>() }));
vi.mock('@/lib/tour', () => ({ startTour: tourMock.startTour }));

beforeEach(async () => {
  await resetStoreWithCompany();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async () => new Response(readReply(false))),
  );
  tourMock.startTour.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderChecklist(role: Role | null, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PermissionContext.Provider
        value={permissionValue(role, role ? 'resolved' : 'not-applicable')}
      >
        <GettingStarted />
      </PermissionContext.Provider>
    </MemoryRouter>,
  );
}

describe('Getting started', () => {
  it('renders the checklist inline in the drawer, with one set of drawer controls', async () => {
    renderChecklist('owner');
    const drawer = await screen.findByTestId('getting-started-progress');
    const checklist = within(drawer).getByRole('region', { name: 'Getting started' });
    expect(checklist).toHaveAttribute('data-testid', 'getting-started');
    expect(checklist.closest('[data-slot="card"]')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Hide checklist' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
  });

  it('shows all five milestones immediately and a zero progress bar', async () => {
    renderChecklist('owner');
    expect(await screen.findByTestId('getting-started')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('link', { name: 'Add someone to the schedule' })).toHaveAttribute(
      'href',
      '/resources',
    );
    expect(screen.getByRole('link', { name: 'Add a client' })).toHaveAttribute('href', '/clients');
    expect(screen.getByRole('link', { name: 'Add a project to the client' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.getByRole('link', { name: 'Add an Activity' })).toHaveAttribute(
      'href',
      '/activities',
    );
    expect(screen.getByRole('link', { name: 'Schedule the first piece of work' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByText('Set up manually')).not.toBeInTheDocument();
  });

  it('opens from another page and lets an editor hide the card', async () => {
    const user = userEvent.setup();
    renderChecklist('editor', '/settings');
    expect(await screen.findByTestId('getting-started-progress')).toBeVisible();
    expect(screen.queryByTestId('getting-started')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show checklist' }));
    expect(screen.getByTestId('getting-started')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide checklist', expanded: true }));
    expect(screen.queryByTestId('getting-started')).not.toBeInTheDocument();
    expect(screen.queryByTestId('getting-started-dismiss')).not.toBeInTheDocument();
  });

  it('requires confirmation before an owner dismisses incomplete setup', async () => {
    const user = userEvent.setup();
    renderChecklist('owner');
    await screen.findByTestId('getting-started-progress');
    await user.click(screen.getByTestId('getting-started-dismiss'));
    expect(screen.getByText('Do you really want to hide this forever?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.getByTestId('getting-started-progress')).toBeVisible();
    await user.click(screen.getByTestId('getting-started-dismiss'));
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
  });

  it('renders nothing once the server reports all five steps done', async () => {
    const all = { person: true, client: true, project: true, activity: true, scheduled: true };
    vi.mocked(fetch).mockImplementation(async () => new Response(readReply(false, all)));
    renderChecklist('owner');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('getting-started')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input, init]) => readRequestTarget(input, init).method === 'PUT'),
    ).toBe(false);
  });

  it('shows the server milestones and reads them again after a planning change', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(async () => new Response(readReply(false, { person: true })))
      .mockImplementationOnce(
        async () => new Response(readReply(false, { person: true, client: true })),
      );
    renderChecklist('owner');
    await vi.waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1'),
    );
    act(() =>
      useStore.setState((state) => ({
        planning: { ...state.planning, revision: (state.planning.revision ?? 0) + 1 },
      })),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the bar on screen while a planning change re-reads the milestones', async () => {
    let finish: (reply: Response) => void = () => {};
    vi.mocked(fetch)
      .mockImplementationOnce(async () => new Response(readReply(false, { person: true })))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    renderChecklist('owner');
    await vi.waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1'),
    );
    act(() =>
      useStore.setState((state) => ({
        planning: { ...state.planning, revision: (state.planning.revision ?? 0) + 1 },
      })),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('getting-started-progress')).toBeVisible();
    await act(async () => finish(new Response(readReply(false, { person: true, client: true }))));
    await vi.waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2'),
    );
  });

  it('stops reading a company the server reports dismissed', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetch)
      .mockImplementationOnce(async () => new Response(readReply(true)))
      .mockImplementation(async () => new Response(null, { status: 503 }));
    renderChecklist('owner');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // Let the dismissed reply land before the planning revision moves.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    act(() =>
      useStore.setState((state) => ({
        planning: { ...state.planning, revision: (state.planning.revision ?? 0) + 1 },
      })),
    );
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each(['starting', 'active', 'ending'] as const)(
    'omits privileged getting-started requests while masquerade is %s',
    async (kind) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(readReply(false)));
      vi.stubGlobal('fetch', fetchMock);
      const state = {
        companyId: 'a-studio',
        targetUserId: 'u-editor',
        targetName: 'Clark Kent',
        effectiveRole: 'editor' as const,
        ...masqueradeGrantFor('editor'),
        startedAt: '2026-10-19T10:00:00.000Z',
        expiresAt: '2999-10-19T10:15:00.000Z',
        token: 'test-projection',
      };
      useStore.getState().setMasquerade(
        kind === 'starting'
          ? {
              kind,
              pending: { companyId: state.companyId, targetUserId: state.targetUserId },
              generation: 1,
            }
          : { kind, state, generation: 1 },
      );

      renderChecklist('editor', '/resources');
      // The client reaches fetch asynchronously; give a request time to arrive.
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
      expect(useStore.getState().notice).toBeNull();
    },
  );

  it('aborts pre-projection guidance and reloads normal Editor getting-started guidance after view-as ends', async () => {
    let rejectRead!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, reject) => {
      rejectRead = reject;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(new Response(readReply(false)));
    vi.stubGlobal('fetch', fetchMock);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderChecklist('editor', '/resources');
    // The client builds its request asynchronously, so the read reaches fetch a moment later.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    act(() =>
      useStore.getState().setMasquerade({
        kind: 'starting',
        pending: { companyId: 'a-studio', targetUserId: 'u-editor' },
        generation: 1,
      }),
    );
    await act(async () => rejectRead(new Error('projection forbids the earlier read')));
    expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
    expect(errorLog).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toBeNull();

    act(() => useStore.getState().setMasquerade({ kind: 'inactive' }));
    expect(await screen.findByTestId('getting-started-progress')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('getting-started-dismiss')).not.toBeInTheDocument();
  });

  it('excludes viewers', () => {
    renderChecklist('viewer');
    expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
  });

  it('makes no getting-started request for a viewer when the planning revision advances', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('read failed'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderChecklist('viewer');
    await act(async () =>
      useStore.setState((state) => ({
        planning: { ...state.planning, revision: (state.planning.revision ?? 0) + 1 },
      })),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toBeNull();
  });

  it('ignores the legacy device flag and keeps guidance after a failed server save', async () => {
    localStorage.setItem('capacitylens/gettingStartedDismissed', 'on');
    const requests = createRequestLog();
    const replies = [
      () => new Response(readReply(false), { status: 200 }),
      () => new Response(null, { status: 503 }),
    ];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      requests.record(input, init);
      const reply = replies.shift();
      if (!reply) throw new Error('Unexpected getting-started request');
      return reply();
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderChecklist('owner');
    expect(await screen.findByTestId('getting-started-progress')).toBeVisible();
    await user.click(screen.getByTestId('getting-started-dismiss'));
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByTestId('getting-started-progress')).toBeVisible();
    expect(useStore.getState().notice?.tone).toBe('error');
    const sent = await requests.read();
    expect(
      sent.some(
        ({ path, method, body }) =>
          /^\/api\/v1\/companies\/[^/]+\/getting-started$/.test(path) &&
          method === 'PUT' &&
          body === JSON.stringify({ dismissed: true }),
      ),
    ).toBe(true);
    expect(console.error).toHaveBeenCalledWith('GettingStarted: dismissal could not be saved');
  });

  it('shows guidance after a read failure and retries without logging error details', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('sensitive server detail'))
      .mockResolvedValueOnce(new Response(readReply(false), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderChecklist('owner');
    expect(await screen.findByTestId('getting-started-progress')).toBeVisible();
    expect(screen.getByTestId('getting-started')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(errorLog).toHaveBeenCalledWith('GettingStarted: company state could not be loaded');
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('sensitive server detail');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a non-boolean dismissal flag', { dismissed: 'false' }],
    ['a missing dismissal flag', {}],
    ['an array body', []],
  ])('shows the load failure and retry for %s', async (_description, body) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ data: body }), { status: 200 })),
    );

    renderChecklist('owner');

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.getByTestId('getting-started-progress')).toBeVisible();
    expect(errorLog).toHaveBeenCalledWith('GettingStarted: company state could not be loaded');
  });

  it('does not restore the bar when an earlier navigation read finishes after dismissal', async () => {
    let finishRead!: (response: Response) => void;
    const pendingRead = new Promise<Response>((resolve) => {
      finishRead = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(readReply(false), { status: 200 }))
      .mockReturnValueOnce(pendingRead)
      .mockResolvedValueOnce(new Response(readReply(true), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderChecklist('owner');
    await screen.findByTestId('getting-started-progress');
    await user.click(screen.getByRole('link', { name: 'Add a client' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByTestId('getting-started-dismiss'));
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await vi.waitFor(() =>
      expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument(),
    );
    await act(async () => finishRead(new Response(readReply(false), { status: 200 })));
    expect(screen.queryByTestId('getting-started-progress')).not.toBeInTheDocument();
  });
});
