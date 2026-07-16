import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityList } from './ActivityList'
import { useStore } from '../../store/useStore'
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => resetStoreWithAccount())

describe('ActivityList', () => {
  it('saves an internal activity under the Internal activities section', async () => {
    const user = userEvent.setup()
    render(<ActivityList />)

    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })

    await user.type(within(dialog).getByLabelText('Name'), 'Internal sync')
    // Pick the Internal kind — the project picker disappears (project-less).
    await user.click(within(dialog).getByRole('radio', { name: 'Internal' }))
    expect(within(dialog).queryByLabelText('Project')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.activities).toHaveLength(1)
    expect(useStore.getState().data.activities[0].kind).toBe('internal')
    expect(useStore.getState().data.activities[0].projectId).toBeUndefined()

    expect(screen.getByRole('heading', { name: 'Internal activities' })).toBeInTheDocument()
    const row = within(screen.getByTestId('internal-activities')).getByTestId('activity-row')
    expect(row).toHaveTextContent('Internal sync')
  })

  it('saves a cross-project activity under the Cross-project activities section', async () => {
    const user = userEvent.setup()
    render(<ActivityList />)

    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })

    await user.type(within(dialog).getByLabelText('Name'), 'Design')
    await user.click(within(dialog).getByRole('radio', { name: 'Cross-project' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.activities[0].kind).toBe('repeatable')
    expect(screen.getByRole('heading', { name: 'Cross-project activities' })).toBeInTheDocument()
    const row = within(screen.getByTestId('cross-project-activities')).getByTestId('activity-row')
    expect(row).toHaveTextContent('Design')
  })

  it('adds a project-specific activity, showing the client / project label in the Project-specific activities section', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<ActivityList />)

    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })

    // 'Project-specific' is the default kind, so the project picker is shown.
    await user.type(within(dialog).getByLabelText('Name'), 'My Activity')
    await user.selectOptions(within(dialog).getByLabelText('Project'), project.id)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.activities[0].kind).toBe('project')
    expect(useStore.getState().data.activities[0].projectId).toBe(project.id)

    const row = within(screen.getByTestId('project-specific-activities')).getByTestId('activity-row')
    expect(row).toHaveTextContent('My Activity')
    expect(row).toHaveTextContent('Acme / Lightning')
  })

  it('rejects a project-specific activity with no project chosen', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<ActivityList />)

    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })

    // Default kind is Project-specific; leave the project unselected and Save.
    await user.type(within(dialog).getByLabelText('Name'), 'Orphan')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    // The dialog stays open with a field error, and no activity is created.
    expect(screen.getByRole('dialog', { name: 'Add activity' })).toBeInTheDocument()
    expect(within(dialog).getByText('A project-specific activity must be assigned to a project.')).toBeInTheDocument()
    expect(useStore.getState().data.activities).toHaveLength(0)
  })

  it('hides an activity under an archived project', () => {
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    useStore.getState().addActivity({ name: 'My Activity', kind: 'project', projectId: project.id })
    useStore.getState().archiveEntity('projects', project.id)

    render(<ActivityList />)

    expect(screen.queryByText('My Activity')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-specific-activities')).not.toBeInTheDocument()
  })

  it('hides an activity whose project belongs to an archived client', () => {
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    useStore.getState().addActivity({ name: 'My Activity', kind: 'project', projectId: project.id })
    useStore.getState().archiveEntity('clients', client.id)

    render(<ActivityList />)

    expect(screen.queryByText('My Activity')).not.toBeInTheDocument()
  })

  // An unresolvable projectId means different things per mode (mirrors ProjectList's clientName
  // tests): in SERVER mode the per-account read strips archived parents from the slice, so it
  // reads as "(archived project)"; in the DEMO build the raw slice retains archived projects, so
  // it is genuinely dangling data and must NOT be dressed up as archival.
  const seedOrphanActivity = () => {
    useStore.getState().replaceAll(
      makeAppData({
        activities: [
          {
            id: 'act-orphan',
            accountId: DEFAULT_ACCOUNT_ID,
            createdAt: 't',
            updatedAt: 't',
            name: 'Orphan Activity',
            kind: 'project',
            projectId: 'nonexistent-project',
          },
        ],
      }),
    )
    useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
  }

  it('server mode hides an activity whose project resolves nowhere', () => {
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '') // server mode is any value other than '1'
    seedOrphanActivity()

    render(<ActivityList />)

    expect(screen.queryByText('Orphan Activity')).not.toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('demo mode also hides an activity whose project resolves nowhere', () => {
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1')
    seedOrphanActivity()

    render(<ActivityList />)

    expect(screen.queryByText('Orphan Activity')).not.toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('confirms before deleting and removes the activity from the list', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    useStore.getState().addActivity({ name: 'My Activity', kind: 'project', projectId: project.id })
    render(<ActivityList />)

    expect(screen.getByTestId('activity-row')).toBeInTheDocument()

    // Click Delete on the activity row — a confirm dialog appears
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete activity\?/i)

    // Cancel keeps the activity
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.activities).toHaveLength(1)

    // Confirm removes the activity
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.activities).toHaveLength(0)
    expect(screen.queryByTestId('activity-row')).not.toBeInTheDocument()
  })
})
