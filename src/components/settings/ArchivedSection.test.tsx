import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArchivedSection } from './ArchivedSection'
import { useStore } from '../../store/useStore'
import { makeAccount, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData, Client, Project, Resource } from '@capacitylens/shared/types/entities'

// ArchivedSection is the Settings → "Archived & deleted" admin view (P2.5b). These tests cover the
// demo build (no server): it reads the inactive rows straight from the store (useInactiveScopedData),
// always renders (everyone is owner locally), and drives the store's lifecycle actions. The last
// test mocks fetch + flips server mode on to prove the 403-self-hide.

// apiConfig is mocked with a MUTABLE server flag so most tests run in the demo build (false) while the
// final self-hide test flips it to true. `API_BASE` is set so the server-mode fetch URL is well-formed.
// The flag lives in a vi.hoisted() box (the mock factory is hoisted above plain `let`s, so a bare
// variable would throw "Cannot access before initialization"); the mocked isServerConfigured READS it
// at call time, so flipping it takes effect on the next render without re-mocking.
const cfg = vi.hoisted(() => ({ serverOn: false }))
vi.mock('../../data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => cfg.serverOn,
}))

const TS = '2026-05-01T00:00:00.000Z'

function resource(over: Partial<Resource>): Resource {
  return {
    id: 'r1',
    accountId: DEFAULT_ACCOUNT_ID,
    createdAt: TS,
    updatedAt: TS,
    kind: 'person',
    name: 'Alice',
    role: 'Designer',
    employmentType: 'permanent',
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    color: '#6366f1',
    ...over,
  }
}

function client(over: Partial<Client>): Client {
  return { id: 'c1', accountId: DEFAULT_ACCOUNT_ID, createdAt: TS, updatedAt: TS, name: 'Acme', color: '#111', ...over }
}

function project(over: Partial<Project>): Project {
  return {
    id: 'p1',
    accountId: DEFAULT_ACCOUNT_ID,
    createdAt: TS,
    updatedAt: TS,
    name: 'Lightning',
    clientId: 'c1',
    color: '#222',
    ...over,
  }
}

/** An ISO timestamp `days` ago from now — to seed a tombstone older/younger than the 30-day window. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function seed(data: Partial<AppData>): void {
  useStore.getState().replaceAll({ ...emptyAppData(), accounts: [makeAccount()], ...data })
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID)
  useStore.getState().setNotice(null)
  useStore.getState().setActiveRole(null)
}

beforeEach(() => {
  cfg.serverOn = false // demo build by default; the self-hide test flips it on.
  seed({})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals() // drop any per-test fetch stub so server-mode tests can't leak into each other
})

describe('ArchivedSection — demo build (store source)', () => {
  it('renders an empty state when nothing is archived or deleted', () => {
    seed({ resources: [resource({})] }) // one ACTIVE resource → not listed
    render(<ArchivedSection />)
    expect(screen.getByTestId('archived-section')).toBeInTheDocument()
    expect(screen.getByText('Nothing archived or deleted.')).toBeInTheDocument()
    expect(screen.queryByTestId('archived-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deleted-row')).not.toBeInTheDocument()
  })

  it('lists archived and deleted rows across the three tables', () => {
    seed({
      resources: [resource({ id: 'r-arch', name: 'Archived Person', archivedAt: TS })],
      clients: [client({ id: 'c-arch', name: 'Archived Client', archivedAt: TS })],
      projects: [project({ id: 'p-del', name: 'Deleted Project', archivedAt: TS, deletedAt: daysAgo(1) })],
    })
    render(<ArchivedSection />)

    const archivedRows = screen.getAllByTestId('archived-row')
    expect(archivedRows).toHaveLength(2)
    expect(screen.getByText('Archived Person')).toBeInTheDocument()
    expect(screen.getByText('Archived Client')).toBeInTheDocument()

    const deletedRows = screen.getAllByTestId('deleted-row')
    expect(deletedRows).toHaveLength(1)
    expect(screen.getByText('Deleted Project')).toBeInTheDocument()
  })

  it('Restore dispatches unarchiveEntity (row returns to active)', async () => {
    const user = userEvent.setup()
    seed({ resources: [resource({ id: 'r-arch', name: 'Archived Person', archivedAt: TS })] })
    render(<ArchivedSection />)

    await user.click(screen.getByRole('button', { name: 'Restore Archived Person' }))

    const r = useStore.getState().data.resources.find((x) => x.id === 'r-arch')!
    expect(r.archivedAt).toBeUndefined() // back to active
  })

  it('Delete (soft-delete) dispatches softDeleteEntity and scrubs a resource name', async () => {
    const user = userEvent.setup()
    seed({ resources: [resource({ id: 'r-arch', name: 'Archived Person', archivedAt: TS })] })
    render(<ArchivedSection />)

    await user.click(screen.getByRole('button', { name: 'Delete Archived Person' }))
    // Confirm the danger dialog.
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const r = useStore.getState().data.resources.find((x) => x.id === 'r-arch')!
    expect(r.deletedAt).toBeTruthy()
    // The resource name is scrubbed to the obfuscated token on soft-delete.
    expect(r.name).toMatch(/^Removed person #/)
  })

  it('keeps one quote pair around a private code name in archived confirmation copy', async () => {
    const user = userEvent.setup()
    seed({
      clients: [client({
        name: '"Northstar"',
        isPrivate: true,
        codeName: undefined,
        archivedAt: TS,
      })],
    })
    render(<ArchivedSection />)

    await user.click(screen.getByRole('button', { name: 'Delete "Northstar"' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this item?' })
    expect(dialog).toHaveTextContent('Delete "Northstar"?')
    expect(dialog).not.toHaveTextContent('""Northstar""')
  })

  // A RENDER test, not an obfuscation proof: that the admin view DISPLAYS a resource tombstone's
  // already-scrubbed name verbatim. (The scrub itself is proven by the soft-delete test above and the
  // store's softDeleteEntity spec — this only seeds an already-obfuscated name and checks it shows.)
  it('displays a resource tombstone’s already-scrubbed name verbatim', () => {
    seed({
      resources: [resource({ id: 'r-del', name: 'Removed person #r-de', archivedAt: TS, deletedAt: daysAgo(1) })],
    })
    render(<ArchivedSection />)
    expect(screen.getByTestId('deleted-row')).toHaveTextContent(/Removed person #/)
  })

  it('DISABLES the purge button for a <30-day tombstone (with the locked hint)', () => {
    seed({ clients: [client({ id: 'c-del', name: 'Young Tombstone', archivedAt: TS, deletedAt: daysAgo(5) })] })
    render(<ArchivedSection />)

    const purgeBtn = screen.getByRole('button', { name: 'Permanently delete Young Tombstone' })
    expect(purgeBtn).toBeDisabled()
    expect(screen.getByText('Can be permanently deleted 30 days after deletion')).toBeInTheDocument()
  })

  it('ENABLES the purge button for a ≥30-day tombstone and purges on confirm', async () => {
    const user = userEvent.setup()
    seed({ clients: [client({ id: 'c-old', name: 'Old Tombstone', archivedAt: TS, deletedAt: daysAgo(40) })] })
    render(<ArchivedSection />)

    const purgeBtn = screen.getByRole('button', { name: 'Permanently delete Old Tombstone' })
    expect(purgeBtn).toBeEnabled()

    await user.click(purgeBtn)
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))

    // The tombstone is physically removed from the store.
    expect(useStore.getState().data.clients.find((c) => c.id === 'c-old')).toBeUndefined()
  })
})

describe('ArchivedSection — server mode self-hide', () => {
  it('renders nothing when the inactive read returns 403', async () => {
    cfg.serverOn = true // flip server mode on for THIS test (an active account is already seeded).
    // Capture the URL the effect requests so we can assert it hit the includeInactive read; the mock
    // always 403s (the non-admin case), which self-hides the section.
    const requested: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requested.push(url)
      return { ok: false, status: 403, json: async () => ({}) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<ArchivedSection />)
    // The effect must actually FIRE the ?includeInactive=1 read, then a 403 self-hides the section.
    await waitFor(() => expect(requested.length).toBeGreaterThan(0))
    await waitFor(() => expect(container.querySelector('[data-testid="archived-section"]')).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Archived & deleted' })).not.toBeInTheDocument()
    expect(requested[0]).toContain('includeInactive=1')
  })

  // The fetched body is untrusted input: a 200 that is NOT a structurally complete slice (proxy
  // error page, wrong-version server) must surface as an ERROR notice, not silently render as an
  // empty archived list the admin would mistake for "nothing archived". The structural gate lives
  // in the shared fetchInactiveSlice (also DeleteCompanyDialog's "Export first" source).
  it('surfaces an error notice (not an empty list) when the inactive read returns a malformed body', async () => {
    cfg.serverOn = true
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ definitely: 'not CapacityLens' }) }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ArchivedSection />)

    // The structural gate refuses the body and routes it to the section's error surface…
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/incomplete/i))
    expect(useStore.getState().notice?.tone).toBe('error')
    // …while the section itself still renders (shown, empty) rather than self-hiding.
    expect(screen.getByTestId('archived-section')).toBeInTheDocument()
    expect(screen.queryByTestId('archived-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deleted-row')).not.toBeInTheDocument()
  })
})
