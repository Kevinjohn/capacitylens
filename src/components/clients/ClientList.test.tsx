import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientList } from './ClientList'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount } from '../../test/fixtures'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { internalClientFor } from '@capacitylens/shared/data/internalClient'

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

// P2.5b: the per-row "Delete" affordance now ARCHIVES (soft-delete is reached later from
// Settings → Archived & deleted). LOCAL mode here → the store's archiveEntity: the client gets
// `archivedAt` set (its projects/activities are RETAINED — archiving is reversible, unlike the old
// cascade-delete) and vanishes from this active-only list.
describe('ClientList archive flow', () => {
  it('confirms before archiving and keeps the client + its children in the data', async () => {
    const user = userEvent.setup()
    const client = useStore.getState().addClient({ name: 'Acme', color: '#111' })
    const project = useStore.getState().addProject({ name: 'P', clientId: client.id, color: '#222' })
    useStore.getState().addActivity({ name: 'T', kind: 'project', projectId: project.id })
    render(<ClientList />)

    expect(screen.getByText('Acme')).toBeInTheDocument()

    // Open the row's archive -> a confirm dialog appears.
    await user.click(screen.getByRole('button', { name: 'Archive Acme' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Archive client\?/i)

    // Cancel keeps it active.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.clients[0].archivedAt).toBeUndefined()

    // Confirm archives it (children retained — archiving is reversible, not a cascade-delete).
    await user.click(screen.getByRole('button', { name: 'Archive Acme' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }))

    expect(useStore.getState().data.clients).toHaveLength(1)
    expect(useStore.getState().data.clients[0].archivedAt).toBeTruthy()
    expect(useStore.getState().data.projects).toHaveLength(1)
    expect(useStore.getState().data.activities).toHaveLength(1)
    // Gone from the active-only management list.
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
  })
})

// The built-in Internal client is a behind-the-scenes data anchor, NOT a user-managed client, so it
// is HIDDEN from this management list (ClientList filters out isBuiltinClient). It must therefore
// carry NO Archive affordance here — archiving it is forbidden, and the list never even shows its row.
describe('ClientList withholds the Archive affordance for the built-in Internal client', () => {
  it('renders no row and no Archive control for the Internal client (only normal clients show)', () => {
    // Mint the one builtin Internal via addAccount (the privileged path), then add a normal client so
    // the list isn't empty — matching internalClient.test.ts / the lifecycle suite's seeding.
    useStore.getState().replaceAll(emptyAppData())
    const a = useStore.getState().addAccount({ name: 'Acme Co', color: '#6366f1' })
    useStore.getState().setActiveAccount(a.id)
    const internal = internalClientFor(useStore.getState().data.clients, a.id)!
    useStore.getState().addClient({ name: 'Globex', color: '#3b82f6' })

    render(<ClientList />)

    // The normal client shows and is archivable; the Internal client shows NO row and NO Archive control.
    expect(screen.getByText('Globex')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive Globex' })).toBeInTheDocument()
    expect(screen.queryByText(internal.name)).not.toBeInTheDocument() // 'Internal' name is filtered out
    expect(screen.queryByRole('button', { name: `Archive ${internal.name}` })).not.toBeInTheDocument()
  })
})
