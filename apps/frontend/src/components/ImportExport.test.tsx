import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { buildBetaExport, parseBetaExport } from '@capacitylens/shared/data/betaTransfer';
import { seed } from '@capacitylens/shared/data/seed';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import { PermissionContext } from '@/auth/permissionContext';
import { useStore } from '@/store/useStore';
import { loadPlanningData, resetStoreWithAccount } from '@/test/fixtures';
import { companyDocument } from '@/test/companyDocument';
import { ImportExport } from './ImportExport';
import { useServerImport } from './import-export/useServerImport';

const refreshOverride = vi.hoisted(() => ({ result: { kind: 'reloaded' } as { kind: string } }));
const planningProbe = vi.hoisted(() => ({ releases: 0, suspends: 0 }));
const originalPlanning = {
  refreshPlanning: useStore.getState().refreshPlanning,
  planningReadyForReplacement: useStore.getState().planningReadyForReplacement,
  suspendPlanningCommands: useStore.getState().suspendPlanningCommands,
};

const accountId = 'a-studio';

function document() {
  return companyDocument(accountId);
}

/** A preview reply as the server sends it for {@link document}. */
function previewReply(baseRevision: number) {
  const data = document().data;
  return Response.json({
    baseRevision,
    imported: 5,
    changed: true,
    companyName: 'Wayne Enterprises',
    counts: Object.fromEntries(SCOPED_KEYS.map((key) => [key, data[key].length])),
  });
}

function renderTools() {
  useStore.setState({
    refreshPlanning: async () => refreshOverride.result.kind === 'reloaded',
    planningReadyForReplacement: () => true,
    suspendPlanningCommands: () => {
      planningProbe.suspends += 1;
      return () => {
        planningProbe.releases += 1;
      };
    },
  });
  return render(
    <PermissionContext.Provider value={{ role: 'owner', status: 'resolved' }}>
      <ImportExport />
    </PermissionContext.Provider>,
  );
}

function selectFile(contents: string) {
  const input = screen.getByTestId('import-input');
  Object.defineProperty(input, 'files', {
    value: [new File([contents], 'transfer.json', { type: 'application/json' })],
    configurable: true,
  });
  fireEvent.change(input);
}

async function previewFile(file: unknown) {
  selectFile(JSON.stringify(file));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  await screen.findByRole('button', { name: 'Replace data' });
}

async function submitServerImport(applyResponse: Response): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/transfer/preview')) {
        return previewReply(7);
      }
      if (String(url).endsWith('/api/auth/password-confirmation')) {
        return Response.json({ confirmationId: 'proof-7' });
      }
      if (String(url).endsWith('/api/transfer/apply')) return applyResponse;
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  renderTools();
  await previewFile(document());
  fireEvent.click(screen.getByRole('button', { name: 'Replace data' }));
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'current-password' } });
  fireEvent.click(screen.getByTestId('password-confirmation-submit'));
  await waitFor(() => expect(planningProbe.suspends).toBe(1));
}

beforeEach(async () => {
  refreshOverride.result = { kind: 'reloaded' };
  planningProbe.suspends = 0;
  planningProbe.releases = 0;
  await resetStoreWithAccount(accountId);
  loadPlanningData(seed());
  sessionStorage.clear();
  window.history.replaceState(null, '', '/settings');
});

afterEach(() => {
  useStore.setState(originalPlanning);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('beta import and export', () => {
  it('dispatches one replacement when confirmation is pressed twice before a response', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useServerImport());
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.confirm(document(), 1, 'proof-1');
      second = result.current.confirm(document(), 1, 'proof-1');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    finish(Response.json({ error: 'Import refused.' }, { status: 403 }));
    await Promise.all([first, second]);
  });

  it('does not dispatch an ordinary import from an unsettled recovery-readable context', async () => {
    useStore.setState((state) => ({
      planning: { ...state.planning, status: 'error', revision: null },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useServerImport());

    await result.current.confirm(document(), 1, 'proof-1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().notice?.tone).toBe('error');
    const releaseRecovery = useStore.getState().suspendPlanningCommands();
    if (!releaseRecovery) {
      throw new Error('The selected context was not available for authority recovery.');
    }
    releaseRecovery();
  });

  it.each([false, true])(
    'does not recover an old import into a successor context (return to A: %s)',
    async (returnToA) => {
      let finish!: (response: Response) => void;
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const first = renderHook(() => useServerImport());
      const second = renderHook(() => useServerImport());
      const oldOperation = first.result.current.confirm(document(), 1, 'proof-old');
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      await second.result.current.confirm(document(), 1, 'proof-second');
      expect(fetchMock).toHaveBeenCalledOnce();

      useStore.getState().setActiveAccount('a-loft');
      await useStore.getState().refreshPlanning();
      if (returnToA) {
        useStore.getState().setActiveAccount(accountId);
        await useStore.getState().refreshPlanning();
      }
      const successorRelease = useStore.getState().suspendPlanningCommands();
      if (!successorRelease) throw new Error('The successor planning context was not ready.');
      const successorNotice = useStore.getState().notice;
      const refresh = vi.fn(async () => true);
      useStore.setState({ refreshPlanning: refresh });

      finish(Response.json({ error: 'Outcome unavailable' }, { status: 503 }));
      await oldOperation;
      expect(refresh).not.toHaveBeenCalled();
      expect(useStore.getState().notice).toBe(successorNotice);
      expect(useStore.getState().planningReadyForReplacement()).toBe(false);
      successorRelease();
    },
  );

  it("exports the selected company's full beta document", async () => {
    let downloaded: Blob | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        downloaded = blob;
        return 'blob:transfer';
      }),
      revokeObjectURL: vi.fn(),
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toContain(`/api/state?accountId=${accountId}&includeInactive=1`);
      return Response.json(document().data);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderTools();
    fireEvent.click(screen.getByTestId('export-data'));
    await waitFor(() => {
      expect(useStore.getState().notice).toBeNull();
      expect(downloaded).toBeDefined();
    });
    if (!downloaded) throw new Error('The export was not downloaded.');
    const exported = parseBetaExport(await downloaded.text());
    expect(exported.format).toBe('capacitylens-beta');
    expect(exported.completeness).toBe('full');
    expect(exported.data.accounts.map((row) => row.id)).toEqual([accountId]);
    expect(exported.data.resources[0]?.id).toBeDefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses a malformed inactive server slice instead of downloading a repaired backup', async () => {
    const bad = buildBetaExport(seed(), { accountId, completeness: 'full' }).data;
    const client = bad.clients[0];
    if (!client) throw new Error('The export fixture has no client.');
    Object.assign(client, { archivedAt: 'yesterday' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(bad)),
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderTools();
    fireEvent.click(screen.getByTestId('export-data'));
    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'));
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses a file that is not JSON without asking the server', async () => {
    const before = structuredClone(useStore.getState().data);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderTools();
    selectFile('{ "format":');
    await waitFor(() =>
      expect(useStore.getState().notice?.message).toMatch(/not valid CapacityLens JSON/),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useStore.getState().data).toEqual(before);
  });

  it("shows the server's reason for refusing a document in the preview dialog", async () => {
    const before = structuredClone(useStore.getState().data);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'format: is not a beta-native CapacityLens export' },
          { status: 400 },
        ),
      ),
    );
    renderTools();
    selectFile('{ "hello": "world" }');
    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('dialog')).toContainElement(alert);
    expect(alert).toHaveTextContent('format: is not a beta-native CapacityLens export');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(useStore.getState().data).toEqual(before);
  });

  it('binds server preview, password proof and apply to one document and revision', async () => {
    const incoming = document();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ url: path, body });
        if (path.endsWith('/api/transfer/preview')) {
          return previewReply(7);
        }
        if (path.endsWith('/api/auth/password-confirmation')) {
          return Response.json({ confirmationId: 'proof-7' });
        }
        if (path.endsWith('/api/transfer/apply')) {
          return Response.json({ imported: 5, changed: true, revision: 8 });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    renderTools();
    await previewFile(incoming);
    fireEvent.click(screen.getByRole('button', { name: 'Replace data' }));
    expect(requests.map((request) => request.url)).toEqual(['/api/transfer/preview']);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'current-password' } });
    fireEvent.click(screen.getByTestId('password-confirmation-submit'));
    await waitFor(() =>
      expect(requests.map((request) => request.url)).toEqual([
        '/api/transfer/preview',
        '/api/auth/password-confirmation',
        '/api/transfer/apply',
      ]),
    );
    expect(requests[1]?.body).toMatchObject({
      action: 'import',
      accountId,
    });
    expect(requests[1]?.body.intent).toEqual({ baseRevision: 7, document: incoming });
    expect(requests[2]?.body).toMatchObject({
      accountId,
      baseRevision: 7,
      confirmationId: 'proof-7',
    });
    expect(requests[2]?.body.document).toEqual(incoming);
  });

  it.each([403, 409])('releases planning commands after a refused %i import', async (status) => {
    await submitServerImport(Response.json({ error: 'Import refused.' }, { status }));
    await waitFor(() => expect(planningProbe.releases).toBe(1));
    expect(useStore.getState().notice).toMatchObject({ tone: 'error', message: 'Import refused.' });
  });

  it('reloads the authoritative slice after an uncertain import response', async () => {
    await submitServerImport(Response.json({ error: 'Unknown outcome.' }, { status: 503 }));
    await waitFor(() => expect(planningProbe.releases).toBe(1));
    expect(useStore.getState().notice?.tone).toBe('warning');
  });

  it('keeps commands suspended and requires reload when a committed import refresh fails', async () => {
    refreshOverride.result = { kind: 'failed' };
    await submitServerImport(Response.json({ imported: 5, changed: true, revision: 8 }));
    await screen.findByTestId('import-reload-required');
    expect(planningProbe.releases).toBe(0);
    expect(useStore.getState().notice?.tone).toBe('error');
  });

  it("ignores a cancelled file's late preview before confirming a newer selection", async () => {
    const first = document();
    const second = document();
    const secondAccount = second.data.accounts[0];
    if (!secondAccount) throw new Error('The second import fixture has no company.');
    secondAccount.name = 'Wayne Enterprises replacement';
    const previews: Array<(response: Response) => void> = [];
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const path = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ url: path, body });
        if (path.endsWith('/api/transfer/preview')) {
          return new Promise<Response>((resolve) => previews.push(resolve));
        }
        if (path.endsWith('/api/auth/password-confirmation')) {
          return Promise.resolve(Response.json({ confirmationId: 'proof-b' }));
        }
        if (path.endsWith('/api/transfer/apply')) {
          return Promise.resolve(Response.json({ imported: 5, changed: true, revision: 23 }));
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    renderTools();
    selectFile(JSON.stringify(first));
    await waitFor(() => expect(previews).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    selectFile(JSON.stringify(second));
    await waitFor(() => expect(previews).toHaveLength(2));
    previews[0]?.(previewReply(11));
    // Let the stale reply settle completely before checking it was ignored.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    previews[1]?.(previewReply(22));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Replace data' });
    fireEvent.click(screen.getByRole('button', { name: 'Replace data' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'current-password' } });
    fireEvent.click(screen.getByTestId('password-confirmation-submit'));
    await waitFor(() =>
      expect(requests.some((request) => request.url.endsWith('/api/transfer/apply'))).toBe(true),
    );
    const proof = requests.find((request) =>
      request.url.endsWith('/api/auth/password-confirmation'),
    );
    expect(proof?.body.intent).toEqual({ baseRevision: 22, document: second });
    const apply = requests.find((request) => request.url.endsWith('/api/transfer/apply'));
    expect(apply?.body).toMatchObject({ baseRevision: 22, confirmationId: 'proof-b' });
    expect(apply?.body.document).toEqual(second);
  });

  it.each(['admin', 'editor', 'viewer'] as const)(
    'hides server import from a %s while keeping export',
    (role) => {
      render(
        <PermissionContext.Provider value={{ role, status: 'resolved' }}>
          <ImportExport />
        </PermissionContext.Provider>,
      );
      expect(screen.queryByTestId('import-input')).toBeNull();
      expect(screen.getByTestId('export-data')).toBeInTheDocument();
    },
  );
});
