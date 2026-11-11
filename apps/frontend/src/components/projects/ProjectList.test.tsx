import type { ReactNode } from 'react';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { requireCreated } from '@/test/requireCreated';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render as renderTestingLibrary, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectList } from './ProjectList';
import { useStore } from '@/store/useStore';
import {
  loadPlanningData,
  DEFAULT_ACCOUNT_ID,
  makeAppData,
  resetStoreWithAccount,
  requireValue,
} from '@/test/fixtures';
import { MemoryRouter } from 'react-router-dom';
import { OwnerPermissions } from '@/test/ownerPermissions';
import { AuthContext } from '@/auth/authContext';
import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch';

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        authMode: 'password-only',
        user: { id: 'test-principal' },
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <OwnerPermissions>{children}</OwnerPermissions>
    </AuthContext.Provider>
  );
}

const render = (ui: Parameters<typeof renderTestingLibrary>[0]) =>
  renderTestingLibrary(ui, { wrapper: TestProviders });

function mockInactiveRead() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const data = structuredClone(useStore.getState().data);
      const internal = buildInternalClient(DEFAULT_ACCOUNT_ID, '2026-01-01T00:00:00.000Z');
      return Response.json({
        ...data,
        clients: [...data.clients.filter((client) => client.id !== internal.id), internal],
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await resetStoreWithAccount();
  useStore.getState().clearFilters();
  mockInactiveRead();
});

describe('ProjectList', () => {
  it('sorts by effective client then effective project name without changing stored order', async () => {
    const zuluClient = await requireCreated(
      useStore.getState().addClient({ name: 'Zulu Client', color: '#2d75da' }),
    );
    const alphaClient = await requireCreated(
      useStore.getState().addClient({ name: 'Alpha Client', color: '#76a5e7' }),
    );
    const alphaZuluProject = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Alpha Project', clientId: zuluClient.id, color: '#da2d92' }),
    );
    const zuluBravoProject = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Zulu Project', clientId: zuluClient.id, color: '#5c34d4' }),
    );
    const betaAlphaProject = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Beta Project', clientId: alphaClient.id, color: '#9c3ace' }),
    );
    const betaZuluProject = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Zulu Project', clientId: alphaClient.id, color: '#f5bcbc' }),
    );

    loadPlanningData({
      ...useStore.getState().data,
      clients: useStore
        .getState()
        .data.clients.map((client) =>
          client.id === alphaClient.id
            ? { ...client, isPrivate: true, codeName: '  Beta Client  ' }
            : client,
        ),
      projects: useStore.getState().data.projects.map((project) => {
        if (project.id === alphaZuluProject.id) {
          return { ...project, isPrivate: true, codeName: 'Zulu Project' };
        }
        if (project.id === zuluBravoProject.id) {
          return { ...project, isPrivate: true, codeName: 'Bravo Project' };
        }
        if (project.id === betaZuluProject.id) {
          return { ...project, isPrivate: true, codeName: 'Alpha Project' };
        }
        return project;
      }),
    });
    const storedIds = useStore.getState().data.projects.map((project) => project.id);

    render(
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>,
    );

    expect(
      screen
        .getAllByTestId('project-row')
        .map((row) => row.querySelector('.font-medium')?.textContent),
    ).toEqual([
      betaZuluProject.name,
      betaAlphaProject.name,
      zuluBravoProject.name,
      alphaZuluProject.name,
    ]);
    expect(
      screen
        .getAllByTestId('project-row')
        .map((row) => row.querySelector('.text-muted-foreground')?.textContent),
    ).toEqual(['· Alpha Client', '· Alpha Client', '· Zulu Client', '· Zulu Client']);
    expect(useStore.getState().data.projects.map((project) => project.id)).toEqual(storedIds);
  });

  it('shows empty state when there are no projects', () => {
    render(<ProjectList />);
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
  });

  it('lists a seeded project with its client name', async () => {
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    await useStore
      .getState()
      .addProject({ name: 'Alpha Project', clientId: client.id, color: '#e776b8' });

    render(<ProjectList />);

    expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    expect(screen.getByText('· Ferris Corp')).toBeInTheDocument();
  });

  it('gives repeated project edit controls distinct contextual names', async () => {
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    await useStore.getState().addProject({ name: 'Alpha', clientId: client.id, color: '#e776b8' });
    await useStore.getState().addProject({ name: 'Beta', clientId: client.id, color: '#1b4f98' });
    render(<ProjectList />);

    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('adds a project via the form and displays it with the client name', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );

    render(<ProjectList />);

    await user.click(screen.getByRole('button', { name: 'Add project' }));

    const dialog = screen.getByRole('dialog', { name: 'Add project' });
    expect(dialog).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Name'), 'New Project');
    fireEvent.keyDown(within(dialog).getByLabelText('Client', { exact: true }), {
      key: 'ArrowDown',
    });
    fireEvent.click(screen.getByRole('option', { name: 'Ferris Corp' }));

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.getByText('· Ferris Corp')).toBeInTheDocument();

    const projects = useStore.getState().data.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]?.clientId).toBe(client.id);
  });

  // Active planning rows stay scoped separately from the server-shaped inactive slice.
  it('shows the Archive ConfirmDialog when the archive button is clicked', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    const project = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Doomed Project', clientId: client.id, color: '#e776b8' }),
    );
    await useStore.getState().addPhase({ name: 'Discovery', projectId: project.id });

    render(<ProjectList />);

    await user.click(screen.getByRole('button', { name: 'Archive Doomed Project' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Archive "Doomed Project"/);
    expect(dialog).toHaveTextContent(/Archived projects/);
    expect(dialog).toHaveTextContent(
      'This also hides 1 phase and 0 allocations from the schedule; restore the project to bring them back.',
    );
  });

  it('keeps exactly one quote pair around a redacted private code name in confirmation copy', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    const created = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Real project', clientId: client.id, color: '#e776b8' }),
    );
    const project = { ...created, name: '"Aurora"', isPrivate: true };
    loadPlanningData({ ...useStore.getState().data, projects: [project] });
    render(<ProjectList />);

    await user.click(screen.getByRole('button', { name: 'Archive "Aurora"' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' });
    expect(dialog).toHaveTextContent('Archive "Aurora"?');
    expect(dialog).not.toHaveTextContent('""Aurora""');
  });

  it('cancels archival and keeps the project active', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    await useStore
      .getState()
      .addProject({ name: 'Kept Project', clientId: client.id, color: '#e776b8' });

    render(<ProjectList />);

    await user.click(screen.getByRole('button', { name: 'Archive Kept Project' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(requireValue(useStore.getState().data.projects[0], 'active project')).toHaveProperty(
      'archivedAt',
      null,
    );
    expect(screen.getByText('Kept Project')).toBeInTheDocument();
  });

  it('confirms archival and hides the project from the list (kept in the store)', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    const project = await requireCreated(
      useStore
        .getState()
        .addProject({ name: 'Doomed Project', clientId: client.id, color: '#e776b8' }),
    );
    await useStore
      .getState()
      .addActivity({ name: 'Activity 1', kind: 'project', projectId: project.id });

    render(<ProjectList />);

    await user.click(screen.getByRole('button', { name: 'Archive Doomed Project' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' });
    queuePlanningPatch(() => ({
      upserts: [
        { entity: 'projects', row: { ...project, archivedAt: '2026-01-01T00:00:00.000Z' } },
      ],
      removed: [],
    }));
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    expect(useStore.getState().data.projects).toHaveLength(1);
    expect(useStore.getState().data.projects[0]?.archivedAt).toBeTruthy();
    expect(useStore.getState().data.activities).toHaveLength(1);
    expect(screen.queryByTestId('project-row')).not.toBeInTheDocument();
    expect(
      within(await screen.findByTestId('archived-projects-section')).getByText('Doomed Project'),
    ).toBeInTheDocument();
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
  });

  it('hides a project whose client is archived', async () => {
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris Corp', color: '#2d75da' }),
    );
    await useStore
      .getState()
      .addProject({ name: 'Alpha Project', clientId: client.id, color: '#e776b8' });
    const data = useStore.getState().data;
    loadPlanningData({
      ...data,
      clients: data.clients.map((row) =>
        row.id === client.id ? { ...row, archivedAt: '2026-01-01T00:00:00.000Z' } : row,
      ),
    });

    render(
      <MemoryRouter>
        <ProjectList />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('project-row')).not.toBeInTheDocument();
    expect(
      within(await screen.findByTestId('archived-projects-section')).getByText('Alpha Project'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hidden because Client Ferris Corp is archived.')).toBeInTheDocument();
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
  });

  // A dangling client link remains unavailable planning data; it does not prove the parent is archived.
  const seedOrphanProject = () => {
    loadPlanningData(
      makeAppData({
        projects: [
          {
            ...NULLABLE_FIELDS.projects,
            id: 'proj-orphan',
            accountId: DEFAULT_ACCOUNT_ID,
            createdAt: 't',
            updatedAt: 't',
            name: 'Orphan Project',
            clientId: 'nonexistent-client',
            color: '#2d75da',
          },
        ],
      }),
    );
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  };

  it('retains a project whose client resolves nowhere', () => {
    seedOrphanProject();

    render(<ProjectList />);

    expect(screen.getByText('Orphan Project')).toBeInTheDocument();
  });
});
