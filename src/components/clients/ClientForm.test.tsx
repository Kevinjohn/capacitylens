import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientForm } from './ClientForm'
import { useStore } from '../../store/useStore'
import { colorName } from '../../lib/palette'
import { resetStoreWithAccount } from '../../test/fixtures'
import { PermissionContext } from '../../auth/permissionContext'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
})

describe('ClientForm – add mode', () => {
  it('defaults privacy off and requires a code name when the owner enables it', async () => {
    const user = userEvent.setup()
    render(<ClientForm onClose={vi.fn()} />)

    const privacy = screen.getByRole('switch', { name: 'Use a code name' })
    expect(privacy).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByLabelText('Code name')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Embargoed Client')
    await user.click(privacy)
    expect(screen.getByLabelText('Code name')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByLabelText('Code name')).toHaveAttribute('aria-invalid', 'true')
    expect(useStore.getState().data.clients).toHaveLength(0)
  })

  it('stores the real name and an unquoted code name when privacy is enabled', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Real Client Ltd')
    await user.click(screen.getByRole('switch', { name: 'Use a code name' }))
    await user.type(screen.getByLabelText('Code name'), ' “Northstar” ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(useStore.getState().data.clients[0]).toMatchObject({
      name: 'Real Client Ltd',
      isPrivate: true,
      codeName: 'Northstar',
    })
  })

  it('rejects a code name that becomes empty after display quotes are removed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Embargoed Client')
    await user.click(screen.getByRole('switch', { name: 'Use a code name' }))
    await user.type(screen.getByLabelText('Code name'), '""')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByLabelText('Code name')).toHaveAttribute('aria-invalid', 'true')
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.clients).toHaveLength(0)
  })

  it('shows an error and does not close when saving with a blank name', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    // Name field starts empty; click Save without typing anything
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.clients).toHaveLength(0)
  })

  it('shows an error and does not close when saving a whitespace-only name', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(useStore.getState().data.clients).toHaveLength(0)
  })

  it('saves a colour chosen from the swatch picker', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Acme')
    // Open the colour popup (trigger is labelled "<label> (<value>)") and pick a swatch.
    await user.click(screen.getByRole('button', { name: /^Colour \(/ }))
    await user.click(screen.getByRole('button', { name: colorName('#e02727') }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalledOnce()
    const clients = useStore.getState().data.clients
    expect(clients).toHaveLength(1)
    expect(clients[0].color).toBe('#e02727')
  })

  it('associates the error with the offending field (aria-invalid + aria-describedby)', async () => {
    const user = userEvent.setup()
    render(<ClientForm onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    const nameInput = screen.getByLabelText('Name')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    const describedBy = nameInput.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveAttribute('id', describedBy)
  })

  it('adds a client and calls onClose when a valid name is provided', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalledOnce()
    const clients = useStore.getState().data.clients
    expect(clients).toHaveLength(1)
    expect(clients[0].name).toBe('Acme Corp')
  })

  it('trims leading and trailing whitespace from the name', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), '  Trimmed  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(useStore.getState().data.clients[0].name).toBe('Trimmed')
  })

  it('renders the dialog with the Add client title', () => {
    render(<ClientForm onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Add client' })).toBeInTheDocument()
  })

  it('calls onClose when the Cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(useStore.getState().data.clients).toHaveLength(0)
  })
})

describe('ClientForm – Enter key submission', () => {
  it('saves when pressing Enter in the name field', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.keyboard('{Enter}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(useStore.getState().data.clients[0].name).toBe('Acme Corp')
  })

  it('shows validation error when pressing Enter with a blank name', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ClientForm onClose={onClose} />)

    await user.keyboard('{Enter}')

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ClientForm – edit mode', () => {
  it('hides owner-only privacy controls and locks the redacted name for a non-owner', () => {
    const client = useStore.getState().addClient({
      name: '"Northstar"',
      color: '#ff0000',
      isPrivate: true,
      codeName: undefined,
    })
    render(
      <PermissionContext.Provider value={{ role: 'editor' }}>
        <ClientForm client={client} onClose={vi.fn()} />
      </PermissionContext.Provider>,
    )

    expect(screen.queryByRole('switch', { name: 'Use a code name' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByText('Only an account owner can change this private name.')).toBeInTheDocument()
  })

  it('pre-fills the name field with the existing client name', () => {
    const client = useStore.getState().addClient({ name: 'Old Name', color: '#ff0000' })
    render(<ClientForm client={client} onClose={vi.fn()} />)

    expect(screen.getByLabelText('Name')).toHaveValue('Old Name')
  })

  it('renders the dialog with the Edit client title', () => {
    const client = useStore.getState().addClient({ name: 'Old Name', color: '#ff0000' })
    render(<ClientForm client={client} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Edit client' })).toBeInTheDocument()
  })

  it('updates the client name in the store and calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Old Name', color: '#ff0000' })
    render(<ClientForm client={client} onClose={onClose} />)

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClose).toHaveBeenCalledOnce()
    const clients = useStore.getState().data.clients
    expect(clients).toHaveLength(1)
    expect(clients[0].name).toBe('New Name')
    expect(clients[0].id).toBe(client.id)
  })

  it('shows an error and does not close when clearing the name in edit mode', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const client = useStore.getState().addClient({ name: 'Existing', color: '#aabbcc' })
    render(<ClientForm client={client} onClose={onClose} />)

    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onClose).not.toHaveBeenCalled()
    // Store still has the original client unchanged
    expect(useStore.getState().data.clients[0].name).toBe('Existing')
  })

  it('does not create a new client when editing', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Solo', color: '#123456' })
    render(<ClientForm client={client} onClose={vi.fn()} />)

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Solo')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(useStore.getState().data.clients).toHaveLength(1)
  })
})
