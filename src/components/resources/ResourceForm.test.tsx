import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResourceForm } from './ResourceForm'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => resetStoreWithAccount())

describe('ResourceForm placeholder binding', () => {
  it('requires a placeholder to be bound to a project', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ResourceForm kind="placeholder" onClose={onClose} />)

    await user.type(screen.getByLabelText('Role'), 'Senior Designer')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/bound to a project/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.resources).toHaveLength(0)
  })

  it('saves a placeholder once a bound project is chosen', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    render(<ResourceForm kind="placeholder" onClose={onClose} />)

    await user.type(screen.getByLabelText('Role'), 'Senior Designer')
    fireEvent.keyDown(screen.getByLabelText('Bound project'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Acme / Lightning' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    const resources = useStore.getState().data.resources
    expect(resources).toHaveLength(1)
    expect(resources[0].kind).toBe('placeholder')
    expect(resources[0].projectId).toBe(project.id)
  })

  // Editing a placeholder whose bound project is ARCHIVED (hidden from the active-only picker): the
  // current project must appear as a disabled-but-selected option so an unrelated edit (role) can
  // save the unchanged projectId instead of silently blanking the select and sending a changed
  // projectId. Mirrors ProjectForm's archived-client round-trip.
  it('edits a placeholder bound to an archived project without forcing a reassignment', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Lightning', clientId: client.id, color: '#222' })
    const placeholder = useStore.getState().addResource({
      kind: 'placeholder',
      role: 'Designer',
      employmentType: 'permanent',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      projectId: project.id,
      color: '#333',
    })
    useStore.getState().archiveEntity('projects', project.id)
    render(<ResourceForm resource={placeholder} onClose={onClose} />)

    // The archived project renders as a disabled option, still selected as the current value.
    const select = screen.getByLabelText('Bound project')
    expect(select).toHaveTextContent('Acme / Lightning (archived)')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Acme / Lightning (archived)' })).toHaveAttribute('data-disabled')
    fireEvent.keyDown(document, { key: 'Escape' })

    await user.clear(screen.getByLabelText('Role'))
    await user.type(screen.getByLabelText('Role'), 'Senior Designer')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    const saved = useStore.getState().data.resources[0]
    expect(saved.role).toBe('Senior Designer')
    expect(saved.projectId).toBe(project.id) // unchanged, round-tripped
  })
})

describe('ResourceForm working days', () => {
  it('rejects working hours above the shared daily maximum', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ResourceForm kind="person" onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Alice')
    fireEvent.change(screen.getByLabelText('Working hours / day'), { target: { value: '40' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/no more than 24/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.resources).toHaveLength(0)
  })

  it('blocks saving a resource with no working days selected', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ResourceForm kind="person" onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Alice')
    // Deselect the default Mon–Fri set entirely.
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      await user.click(screen.getByRole('button', { name: day }))
    }
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/at least one working day/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.resources).toHaveLength(0)
  })
})
