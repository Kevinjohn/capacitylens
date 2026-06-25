import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientList } from './ClientList'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'

beforeEach(() => resetStoreWithAccount())

describe('ClientList empty state', () => {
  it('shows the enriched empty state with a CTA distinct from the top Add button', () => {
    render(<ClientList />)
    expect(screen.getByText('No clients yet.')).toBeInTheDocument()
    // The empty-state CTA and the page's top button have DISTINCT accessible names, so
    // getByRole stays unambiguous for each (no duplicate-name collision).
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add your first client' })).toBeInTheDocument()
  })

  it('CTA opens the same create form as the top Add button', async () => {
    const user = userEvent.setup()
    render(<ClientList />)
    await user.click(screen.getByRole('button', { name: 'Add your first client' }))
    expect(screen.getByRole('dialog', { name: 'Add client' })).toBeInTheDocument()
  })
})

describe('ClientList delete flow', () => {
  it('confirms before deleting and cascades through the store', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'P', clientId: client.id, color: '#222' })
    useStore.getState().addActivity({ name: 'T', kind: 'project', projectId: project.id })
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
    expect(useStore.getState().data.activities).toHaveLength(0)
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
  })
})
