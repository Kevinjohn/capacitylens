import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectForm } from './ProjectForm'
import { useStore } from '../../store/useStore'
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from '../../test/fixtures'
import { PermissionContext } from '../../auth/permissionContext'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'

beforeEach(() => resetStoreWithAccount())

describe('ProjectForm', () => {
  const installInternalClient = () => {
    const state = useStore.getState()
    const internal = buildInternalClient(DEFAULT_ACCOUNT_ID, '2026-05-01T00:00:00.000Z')
    state.replaceAll({ ...state.data, clients: [...state.data.clients, internal] })
    return internal
  }

  it('stores an owner-configured private project and normalizes display quotes out of storage', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111111' })
    render(<ProjectForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Secret Launch')
    await user.click(screen.getByRole('switch', { name: 'Use a code name' }))
    await user.type(screen.getByLabelText('Code name'), '"Aurora"')
    fireEvent.keyDown(screen.getByLabelText('Client'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: client.name }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(useStore.getState().data.projects[0]).toMatchObject({
      name: 'Secret Launch',
      isPrivate: true,
      codeName: 'Aurora',
    })
  })

  it('rejects a code name that contains only display quotes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111111' })
    render(<ProjectForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Secret Launch')
    await user.click(screen.getByRole('switch', { name: 'Use a code name' }))
    await user.type(screen.getByLabelText('Code name'), '“”')
    fireEvent.keyDown(screen.getByLabelText('Client'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: client.name }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByLabelText('Code name')).toHaveAttribute('aria-invalid', 'true')
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.projects).toHaveLength(0)
  })

  it('does not expose privacy settings or an editable redacted name to a non-owner', () => {
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111111' })
    const project = useStore.getState().addProject({
      name: '"Aurora"',
      clientId: client.id,
      color: '#ec4899',
      isPrivate: true,
      codeName: undefined,
    })
    render(
      <PermissionContext.Provider value={{ role: 'admin' }}>
        <ProjectForm project={project} onClose={vi.fn()} />
      </PermissionContext.Provider>,
    )

    expect(screen.queryByRole('switch', { name: 'Use a code name' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByText('Only an account owner can change this private name.')).toBeInTheDocument()
  })

  it('refuses to save a project without a client', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ProjectForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'New Project')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/must belong to a client/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.projects).toHaveLength(0)
  })

  it('saves when a client is chosen', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    render(<ProjectForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'New Project')
    fireEvent.keyDown(screen.getByLabelText('Client'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: client.name }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    expect(useStore.getState().data.projects).toHaveLength(1)
    expect(useStore.getState().data.projects[0].clientId).toBe(client.id)
  })

  it('hides the colour picker for an Internal-owned project in the default grey mode', async () => {
    const internal = installInternalClient()
    render(<ProjectForm onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^Colour/ })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText('Client'), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: internal.name }))
    expect(screen.queryByRole('button', { name: /^Colour/ })).not.toBeInTheDocument()
  })

  it('reveals the existing picker in palette mode and preserves a hidden saved colour on edit', async () => {
    const user = userEvent.setup()
    const internal = installInternalClient()
    const project = useStore.getState().addProject({
      name: 'Planning', clientId: internal.id, color: '#da2d92',
    })

    const hidden = render(<ProjectForm project={project} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Colour/ })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Planning updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(useStore.getState().data.projects[0].color).toBe('#da2d92')
    hidden.unmount()

    useStore.getState().updateAccount(DEFAULT_ACCOUNT_ID, { internalColourMode: 'palette' })
    render(<ProjectForm project={useStore.getState().data.projects[0]} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Colour/ })).toBeInTheDocument()
  })

  // Editing a project whose client is ARCHIVED (hidden from the active-only picker): the current
  // client must appear as a disabled-but-selected option so an unrelated edit (rename) can save
  // the unchanged clientId instead of being blocked by the picker or the store's ref check.
  it('renames a project under an archived client without forcing a reassignment', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'Alpha', clientId: client.id, color: '#ec4899' })
    useStore.getState().archiveEntity('clients', client.id)
    render(<ProjectForm project={project} onClose={onClose} />)

    // The archived client renders as a disabled option, still selected as the current value.
    const select = screen.getByLabelText('Client')
    expect(select).toHaveTextContent('Acme (archived)')
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Acme (archived)' })).toHaveAttribute('data-disabled')
    fireEvent.keyDown(document, { key: 'Escape' })

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Alpha Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalled()
    expect(useStore.getState().data.projects[0].name).toBe('Alpha Renamed')
    expect(useStore.getState().data.projects[0].clientId).toBe(client.id) // unchanged, round-tripped
  })
})
