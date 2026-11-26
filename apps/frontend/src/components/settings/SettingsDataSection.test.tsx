import { act, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@capacitylens/shared/domain/access';
import { companyDataRequests } from '@/data/companyDataRequests';
import { PermissionContext } from '@/auth/permissionContext';
import { fetchApi } from '@/data/requestTimeout';
import { fetchInactiveRecords } from '@/data/fetchInactiveRecords';
import { reloadPage } from '@/lib/reloadPage';
import { useStore } from '@/store/useStore';
import {
  DEFAULT_COMPANY_ID,
  jsonResponse,
  makeAllocation,
  makeClient,
  makeResource,
  resetStoreWithCompany,
} from '@/test/fixtures';
import { SettingsDataSection } from './SettingsDataSection';
import { permissionValue } from '@/test/permissionGrants';

vi.mock('@/data/requestTimeout', () => ({ fetchApi: vi.fn(), API_BULK_TIMEOUT_MS: 30000 }));
vi.mock('@/data/fetchInactiveRecords', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/fetchInactiveRecords')>()),
  fetchInactiveRecords: vi.fn(),
}));
vi.mock('@/lib/reloadPage', () => ({ reloadPage: vi.fn() }));
vi.mock('@/auth/PasswordConfirmationDialog', () => ({
  PasswordConfirmationDialog: ({ onConfirmed }: { onConfirmed: (id: string) => void }) => (
    <button type="button" onClick={() => onConfirmed('proof-one')}>
      Confirm identity
    </button>
  ),
}));

function renderSection({ role = 'owner' }: { role?: Role | null } = {}) {
  return render(
    <PermissionContext.Provider value={permissionValue(role)}>
      <SettingsDataSection />
    </PermissionContext.Provider>,
  );
}

const owned = { companyId: DEFAULT_COMPANY_ID };
const section = () => screen.queryByTestId('settings-example-data');
const originalPlanning = {
  refreshPlanning: useStore.getState().refreshPlanning,
  planningReadyForReplacement: useStore.getState().planningReadyForReplacement,
  suspendPlanningIntents: useStore.getState().suspendPlanningIntents,
};
const planningProbe = { reads: 0, freshReads: 0, suspends: 0, releases: 0, ready: true };

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  await resetStoreWithCompany();
  planningProbe.reads = 0;
  planningProbe.freshReads = 0;
  planningProbe.suspends = 0;
  planningProbe.releases = 0;
  planningProbe.ready = true;
  // The server's inactive read mirrors the store unless a test says the company holds hidden rows.
  vi.mocked(fetchInactiveRecords).mockImplementation(async () => useStore.getState().data);
  useStore.setState({
    refreshPlanning: async (options) => {
      planningProbe.reads += 1;
      if (options?.fresh) planningProbe.freshReads += 1;
      return true;
    },
    planningReadyForReplacement: () => planningProbe.ready,
    suspendPlanningIntents: () => {
      planningProbe.suspends += 1;
      if (!planningProbe.ready) return null;
      return () => {
        planningProbe.releases += 1;
      };
    },
  });
});
afterEach(() => {
  useStore.setState(originalPlanning);
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Settings example data', () => {
  it('is offered to an admin of an empty company, including one that only holds the Internal client', async () => {
    useStore.setState((state) => ({
      data: {
        ...state.data,
        clients: [
          makeClient({
            id: 'internal',
            name: 'Internal',
            builtin: true,
            companyId: DEFAULT_COMPANY_ID,
          }),
        ],
      },
    }));
    renderSection({ role: 'admin' });
    expect(await screen.findByRole('button', { name: 'Add example data' })).toBeEnabled();
    expect(section()).toBeInTheDocument();
  });

  it.each([
    [
      'an archived person',
      { resources: [makeResource({ ...owned, archivedAt: '2026-01-05T09:00:00.000Z' })] },
    ],
  ])('is hidden when the company still holds %s', async (_label, rows) => {
    vi.mocked(fetchInactiveRecords).mockImplementation(async () => ({
      ...useStore.getState().data,
      ...rows,
    }));
    renderSection();
    await waitFor(() => expect(fetchInactiveRecords).toHaveBeenCalledOnce());
    // Let the resolved read render before asserting the section stayed hidden.
    await act(async () => {});
    expect(section()).not.toBeInTheDocument();
  });

  it('stays hidden until the inactive rows have loaded', () => {
    vi.mocked(fetchInactiveRecords).mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(section()).not.toBeInTheDocument();
  });

  it.each([
    ['a person', { resources: [makeResource(owned)] }],
    ['a client', { clients: [makeClient(owned)] }],
    ['an allocation', { resources: [makeResource(owned)], allocations: [makeAllocation(owned)] }],
  ])('is hidden once the company has %s', (_label, rows) => {
    useStore.setState((state) => ({ data: { ...state.data, ...rows } }));
    renderSection();
    expect(section()).not.toBeInTheDocument();
    expect(fetchInactiveRecords).not.toHaveBeenCalled();
  });

  it('is hidden from an editor', () => {
    renderSection({ role: 'editor' });
    expect(section()).not.toBeInTheDocument();
  });

  it('adds the data, reloads the company and confirms', async () => {
    const add = vi
      .spyOn(companyDataRequests, 'addExampleData')
      .mockResolvedValue(jsonResponse({ added: 15 }, 201));
    renderSection();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add example data' }));
    await waitFor(() => expect(useStore.getState().notice?.message).toBe('Example data added.'));
    expect(add).toHaveBeenCalledWith(DEFAULT_COMPANY_ID);
    expect(planningProbe.reads).toBe(1);
    expect(planningProbe.freshReads).toBe(1);
    expect(planningProbe.releases).toBe(1);
  });

  it("surfaces the server's refusal and does not reload", async () => {
    vi.spyOn(companyDataRequests, 'addExampleData').mockResolvedValue(
      jsonResponse({ error: 'Example data can only be added to an empty company.' }, 409),
    );
    renderSection();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add example data' }));
    await waitFor(() =>
      expect(useStore.getState().notice).toMatchObject({
        tone: 'error',
        message: 'Example data can only be added to an empty company.',
      }),
    );
    expect(planningProbe.reads).toBe(0);
    expect(planningProbe.releases).toBe(1);
  });

  it('does not dispatch example data while a different replacement is unresolved', async () => {
    const add = vi.spyOn(companyDataRequests, 'addExampleData');
    useStore.setState({ suspendPlanningIntents: () => null });
    renderSection();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add example data' }));
    expect(add).not.toHaveBeenCalled();
    expect(useStore.getState().notice?.tone).toBe('error');
  });

  it('keeps the replacement lock after an unknown example-data outcome and failed fresh read', async () => {
    vi.spyOn(companyDataRequests, 'addExampleData').mockResolvedValue(
      jsonResponse({ error: 'Unavailable' }, 503),
    );
    useStore.setState({ refreshPlanning: async () => false });
    renderSection();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add example data' }));
    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'));
    expect(planningProbe.releases).toBe(0);
    expect(useStore.getState().notice?.message).toContain('Unavailable');
    expect(useStore.getState().notice?.message).toContain(
      'Reload this page before making changes.',
    );
  });
});

describe('Company-wide people anonymisation', () => {
  it('offers the clearly named server action to an Owner, but not an Admin or Editor', () => {
    const owner = renderSection({ role: 'owner' });
    const anonymise = screen.getByTestId('settings-company-anonymise');
    expect(anonymise).toBeInTheDocument();
    expect(anonymise).toHaveTextContent('Anonymise all people');
    owner.unmount();
    const admin = renderSection({ role: 'admin' });
    expect(screen.queryByTestId('settings-company-anonymise')).not.toBeInTheDocument();
    admin.unmount();
    renderSection({ role: 'editor' });
    expect(screen.queryByTestId('settings-company-anonymise')).not.toBeInTheDocument();
  });

  it('explains that anonymising all people leaves catalogue records unchanged', async () => {
    renderSection({ role: 'owner' });
    const anonymise = screen.getByTestId('settings-company-anonymise');
    const user = userEvent.setup();
    await user.click(within(anonymise).getByRole('button', { name: 'About Anonymise all people' }));
    const help = screen.getByRole('dialog', { name: 'Anonymise all people' });
    expect(help).toHaveTextContent('clients, projects, activities and planning links');
    await user.click(within(help).getByRole('button', { name: 'Close' }));
    await user.click(within(anonymise).getByRole('button', { name: 'Anonymise all people' }));
    const confirmation = screen.getByRole('dialog', { name: 'Anonymise all people?' });
    expect(confirmation).toHaveTextContent('Clients, projects and activities stay unchanged.');
    expect(confirmation).toHaveTextContent('The company, its members and planning links remain.');
    expect(confirmation).toHaveTextContent('This cannot be undone.');
  });

  it('sends a bound proof to the named server endpoint from a settled planning view', async () => {
    vi.mocked(fetchApi).mockResolvedValue(new Response(null, { status: 204 }));
    renderSection({ role: 'owner' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anonymise all people' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Anonymise all people' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => expect(fetchApi).toHaveBeenCalledOnce());
    expect(planningProbe.suspends).toBe(1);
    expect(fetchApi).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/v1/companies/${DEFAULT_COMPANY_ID}/anonymise$`)),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmationId: 'proof-one' }),
      }),
      expect.any(Number),
    );
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it('refuses replacement when the canonical planning view is unresolved', async () => {
    planningProbe.ready = false;
    renderSection({ role: 'owner' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anonymise all people' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Anonymise all people' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'));
    expect(fetchApi).not.toHaveBeenCalled();
    expect(planningProbe.suspends).toBe(0);
    expect(planningProbe.releases).toBe(0);
  });

  it('refuses company anonymisation when another replacement owns the view', async () => {
    useStore.setState({ suspendPlanningIntents: () => null });
    renderSection({ role: 'owner' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anonymise all people' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Anonymise all people' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'));
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each([408, 500])(
    'keeps planning intents suspended after an uncertain HTTP %s',
    async (status) => {
      vi.mocked(fetchApi).mockResolvedValue(new Response(null, { status }));
      renderSection({ role: 'owner' });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Anonymise all people' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Anonymise all people' }),
      );
      await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument(),
      );
      expect(planningProbe.suspends).toBe(1);
      expect(planningProbe.releases).toBe(0);
    },
  );

  it('keeps planning intents suspended after a lost response', async () => {
    vi.mocked(fetchApi).mockRejectedValue(new Error('Connection lost'));
    renderSection({ role: 'owner' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anonymise all people' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Anonymise all people' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument());
    expect(planningProbe.suspends).toBe(1);
    expect(planningProbe.releases).toBe(0);
  });

  it('releases suspended planning intents after a definitive refusal', async () => {
    vi.mocked(fetchApi).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 }),
    );
    renderSection({ role: 'owner' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Anonymise all people' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Anonymise all people' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await waitFor(() => expect(useStore.getState().notice?.message).toBe('Forbidden.'));
    expect(planningProbe.releases).toBe(1);
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
