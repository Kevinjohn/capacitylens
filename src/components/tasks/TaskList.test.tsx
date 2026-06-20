import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskList } from './TaskList'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => resetStoreWithAccount())

describe('TaskList', () => {
  it('saves an internal task under the Internal tasks section', async () => {
    const user = userEvent.setup()
    render(<TaskList />)

    await user.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add task' })

    await user.type(within(dialog).getByLabelText('Name'), 'Internal sync')
    // Pick the Internal kind — the project picker disappears (project-less).
    await user.click(within(dialog).getByRole('radio', { name: 'Internal' }))
    expect(within(dialog).queryByLabelText('Project')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.tasks).toHaveLength(1)
    expect(useStore.getState().data.tasks[0].kind).toBe('internal')
    expect(useStore.getState().data.tasks[0].projectId).toBeUndefined()

    expect(screen.getByRole('heading', { name: 'Internal tasks' })).toBeInTheDocument()
    const row = within(screen.getByTestId('internal-tasks')).getByTestId('task-row')
    expect(row).toHaveTextContent('Internal sync')
  })

  it('saves a repeatable task under the Repeatable tasks section', async () => {
    const user = userEvent.setup()
    render(<TaskList />)

    await user.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add task' })

    await user.type(within(dialog).getByLabelText('Name'), 'Design')
    await user.click(within(dialog).getByRole('radio', { name: 'Repeatable' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.tasks[0].kind).toBe('repeatable')
    expect(screen.getByRole('heading', { name: 'Repeatable tasks' })).toBeInTheDocument()
    const row = within(screen.getByTestId('repeatable-tasks')).getByTestId('task-row')
    expect(row).toHaveTextContent('Design')
  })

  it('adds a project task, showing the client / project label in the Project tasks section', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<TaskList />)

    await user.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add task' })

    // 'Project' is the default kind, so the project picker is shown.
    await user.type(within(dialog).getByLabelText('Name'), 'My Task')
    await user.selectOptions(within(dialog).getByLabelText('Project'), project.id)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.tasks[0].kind).toBe('project')
    expect(useStore.getState().data.tasks[0].projectId).toBe(project.id)

    const row = within(screen.getByTestId('project-tasks')).getByTestId('task-row')
    expect(row).toHaveTextContent('My Task')
    expect(row).toHaveTextContent('Acme / Lightning')
  })

  it('rejects a project task with no project chosen', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<TaskList />)

    await user.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add task' })

    // Default kind is Project; leave the project unselected and Save.
    await user.type(within(dialog).getByLabelText('Name'), 'Orphan')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    // The dialog stays open with a field error, and no task is created.
    expect(screen.getByRole('dialog', { name: 'Add task' })).toBeInTheDocument()
    expect(within(dialog).getByText('A project task must be assigned to a project.')).toBeInTheDocument()
    expect(useStore.getState().data.tasks).toHaveLength(0)
  })

  it('confirms before deleting and removes the task from the list', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    useStore.getState().addTask({ name: 'My Task', kind: 'project', projectId: project.id })
    render(<TaskList />)

    expect(screen.getByTestId('task-row')).toBeInTheDocument()

    // Click Delete on the task row — a confirm dialog appears
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete task\?/i)

    // Cancel keeps the task
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.tasks).toHaveLength(1)

    // Confirm removes the task
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.tasks).toHaveLength(0)
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument()
  })
})
