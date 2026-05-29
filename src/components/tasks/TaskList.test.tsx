import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskList } from './TaskList'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'

beforeEach(() => useStore.getState().replaceAll(emptyAppData()))

describe('TaskList', () => {
  it('shows an error when saving without a project selected', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<TaskList />)

    await user.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add task' })
    expect(dialog).toBeInTheDocument()

    // Type a name but leave project unselected, then Save
    await user.type(within(dialog).getByLabelText('Name'), 'My Task')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/must belong to a project/i)
    expect(useStore.getState().data.tasks).toHaveLength(0)
  })

  it('adds a task when a project and name are provided, showing the project label in the list', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<TaskList />)

    await user.click(screen.getByRole('button', { name: 'Add task' }))
    const dialog = screen.getByRole('dialog', { name: 'Add task' })

    await user.type(within(dialog).getByLabelText('Name'), 'My Task')
    await user.selectOptions(within(dialog).getByLabelText('Project'), project.id)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useStore.getState().data.tasks).toHaveLength(1)
    expect(useStore.getState().data.tasks[0].projectId).toBe(project.id)

    const row = screen.getByTestId('task-row')
    expect(row).toHaveTextContent('My Task')
    expect(row).toHaveTextContent('Acme / Lightning')
  })

  it('confirms before deleting and removes the task from the list', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    useStore.getState().addTask({ name: 'My Task', projectId: project.id })
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
