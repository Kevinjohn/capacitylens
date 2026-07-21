import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectList } from './ProjectList'
import { useStore } from '../../store/useStore'
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
  // Server is the app default now; the archive-flow tests below assert the LOCAL store-mutation path
  // (no fetch/reload), so opt into the demo build. isServerConfigured() reads the env per dispatch,
  // and the non-archive tests here don't touch persistence mode, so a file-wide stub is harmless.
  vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
})

afterEach(() => vi.unstubAllEnvs())

describe('ProjectList', () => {
  it('shows empty state when there are no projects', () => {
    render(<ProjectList />)
    expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  })

  it('lists a seeded project with its client name', () => {
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })
    useStore.getState().addProject({ name: 'Alpha Project', clientId: client.id, color: '#ec4899' })

    render(<ProjectList />)

    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    expect(screen.getByText('· Acme Corp')).toBeInTheDocument()
  })

  it('adds a project via the form and displays it with the client name', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })

    render(<ProjectList />)

    // Open the add form
    await user.click(screen.getByRole('button', { name: 'Add project' }))

    const dialog = screen.getByRole('dialog', { name: 'Add project' })
    expect(dialog).toBeInTheDocument()

    // Fill in Name and Client
    await user.type(within(dialog).getByLabelText('Name'), 'New Project')
    fireEvent.keyDown(within(dialog).getByLabelText('Client', { exact: true }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Acme Corp' }))

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    // Dialog closes and project appears in the list
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('New Project')).toBeInTheDocument()
    expect(screen.getByText('· Acme Corp')).toBeInTheDocument()

    // Store is updated
    const projects = useStore.getState().data.projects
    expect(projects).toHaveLength(1)
    expect(projects[0].clientId).toBe(client.id)
  })

  // P2.5b: the per-row "Delete" affordance now ARCHIVES (soft-delete is reached later from
  // Settings → Archived & deleted). DEMO mode here → archiveEntity: the project gets `archivedAt`
  // set (its activities are RETAINED — reversible) and vanishes from this active-only list.
  it('shows the Archive ConfirmDialog when the archive button is clicked', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })
    useStore.getState().addProject({ name: 'Doomed Project', clientId: client.id, color: '#ec4899' })

    render(<ProjectList />)

    await user.click(screen.getByRole('button', { name: 'Archive Doomed Project' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Archive "Doomed Project"/)
    expect(dialog).toHaveTextContent(/Archived & deleted/)
  })

  it('keeps exactly one quote pair around a redacted private code name in confirmation copy', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111111' })
    useStore.getState().addProject({
      name: '"Aurora"',
      clientId: client.id,
      color: '#ec4899',
      isPrivate: true,
      codeName: undefined,
    })
    render(<ProjectList />)

    await user.click(screen.getByRole('button', { name: 'Archive "Aurora"' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' })
    expect(dialog).toHaveTextContent('Archive "Aurora"?')
    expect(dialog).not.toHaveTextContent('""Aurora""')
  })

  it('cancels archival and keeps the project active', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })
    useStore.getState().addProject({ name: 'Kept Project', clientId: client.id, color: '#ec4899' })

    render(<ProjectList />)

    await user.click(screen.getByRole('button', { name: 'Archive Kept Project' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.projects[0].archivedAt).toBeUndefined()
    expect(screen.getByText('Kept Project')).toBeInTheDocument()
  })

  it('confirms archival and hides the project from the list (kept in the store)', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Doomed Project', clientId: client.id, color: '#ec4899' })
    useStore.getState().addActivity({ name: 'Activity 1', kind: 'project', projectId: project.id })

    render(<ProjectList />)

    await user.click(screen.getByRole('button', { name: 'Archive Doomed Project' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Archive project?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // Retained in the data (archived, reversible), but gone from the active-only list.
    expect(useStore.getState().data.projects).toHaveLength(1)
    expect(useStore.getState().data.projects[0].archivedAt).toBeTruthy()
    expect(useStore.getState().data.activities).toHaveLength(1)
    expect(screen.queryByText('Doomed Project')).not.toBeInTheDocument()
    expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  })

  it('hides a project whose client is archived', () => {
    const client = useStore.getState().addClient({ name: 'Acme Corp', color: '#111' })
    useStore.getState().addProject({ name: 'Alpha Project', clientId: client.id, color: '#ec4899' })
    useStore.getState().archiveEntity('clients', client.id)

    render(<ProjectList />)

    expect(screen.queryByText('Alpha Project')).not.toBeInTheDocument()
    expect(screen.getByText('No projects yet.')).toBeInTheDocument()
  })

  // An unresolvable clientId means different things per mode: in SERVER mode the per-account read
  // strips archived parents from the slice, so it reads as "archived client"; in the DEMO build the
  // raw slice retains archived clients, so it is genuinely dangling data and must NOT be dressed up
  // as archival.
  const seedOrphanProject = () => {
    // Seed via replaceAll to inject a project whose client is absent from the slice
    useStore.getState().replaceAll(
      makeAppData({
        projects: [
          {
            id: 'proj-orphan',
            accountId: DEFAULT_ACCOUNT_ID,
            createdAt: 't',
            updatedAt: 't',
            name: 'Orphan Project',
            clientId: 'nonexistent-client',
            color: '#abc',
          },
        ],
      }),
    )
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
  }

  it('server mode hides a project whose client resolves nowhere', () => {
    // Override the file-wide demo stub: server mode is any value other than '1'.
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '')
    seedOrphanProject()

    render(<ProjectList />)

    expect(screen.queryByText('Orphan Project')).not.toBeInTheDocument()
  })

  it('demo mode also hides a project whose client resolves nowhere', () => {
    seedOrphanProject() // file-wide demo stub applies

    render(<ProjectList />)

    expect(screen.queryByText('Orphan Project')).not.toBeInTheDocument()
  })
})
