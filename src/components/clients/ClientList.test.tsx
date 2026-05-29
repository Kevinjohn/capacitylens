import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientList } from './ClientList'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'

beforeEach(() => useStore.getState().replaceAll(emptyAppData()))

describe('ClientList delete flow', () => {
  it('confirms before deleting and cascades through the store', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'P', clientId: client.id, color: '#222' })
    useStore.getState().addTask({ name: 'T', projectId: project.id })
    render(<ClientList />)

    expect(screen.getByText('Acme')).toBeInTheDocument()

    // Open the row's delete -> a confirm dialog appears.
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Delete client\?/i)

    // Cancel keeps it.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.clients).toHaveLength(1)

    // Confirm removes it and cascades.
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(useStore.getState().data.clients).toHaveLength(0)
    expect(useStore.getState().data.projects).toHaveLength(0)
    expect(useStore.getState().data.tasks).toHaveLength(0)
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
  })
})
