import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImportExport } from './ImportExport'
import { useStore } from '../store/useStore'
import { PermissionContext } from '../auth/permissionContext'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { seed } from '@capacitylens/shared/data/seed'
import { serializeData } from '@capacitylens/shared/data/transfer'
import { makeResourceDraft, resetStoreWithAccount } from '../test/fixtures'

// ImportExport now branches on the persistence mode (demo = the undoable store import;
// server = the atomic, purge-gated POST /api/import). Mock apiConfig with a mutable flag
// (the AccountPicker.test pattern) so each block pins the mode it exercises; the legacy
// import tests below are the DEMO-build behaviour.
const serverFlag = { on: false }
vi.mock('../data/apiConfig', () => ({
  API_BASE: '',
  isServerConfigured: () => serverFlag.on,
  isDemoMode: () => !serverFlag.on,
}))

// Partial persist mock: everything real EXCEPT refreshActiveAccountSlice, which one test forces
// to 'failed' (a committed import whose re-hydrate breaks), and suspendServerWrites, whose resume
// is recorded so tests can pin the committed/dropParkedEdits bookkeeping (with no orchestrator
// attached the real seam is an unobservable no-op anyway).
const refreshOverride = vi.hoisted(() => ({ value: null as null | 'reloaded' | 'skipped' | 'failed' | 'unattached' }))
const resumeSpy = vi.hoisted(() => ({ calls: [] as unknown[] }))
// When set, the mocked re-hydrate raises this error notice mid-flight — simulating the sticky
// parked-edit loss warning the real orchestrator surfaces via onError → setNotice.
const refreshNotice = vi.hoisted(() => ({ error: null as string | null }))
vi.mock('../data/persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/persist')>()
  return {
    ...actual,
    refreshActiveAccountSlice: async (id: string) => {
      if (refreshNotice.error !== null) {
        useStore.getState().setNotice(refreshNotice.error, 'error')
        return 'reloaded' as const
      }
      return refreshOverride.value ?? actual.refreshActiveAccountSlice(id)
    },
    suspendServerWrites: () => (opts?: unknown) => {
      resumeSpy.calls.push(opts ?? {})
    },
  }
})

beforeEach(() => {
  serverFlag.on = false
  refreshOverride.value = null
  refreshNotice.error = null
  resumeSpy.calls.length = 0
  resetStoreWithAccount()
  useStore.getState().clearFilters()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImportExport – Export', () => {
  it('downloads a JSON blob and revokes the object URL AFTER the click (deferred, not synchronous)', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:x')
    const revokeObjectURL = vi.fn()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })

    render(<ImportExport />)

    fireEvent.click(screen.getByTestId('export-data'))

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled() // deferred past the click so the download isn't truncated

    await new Promise((r) => setTimeout(r, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')

    vi.unstubAllGlobals()
    anchorClick.mockRestore()
  })
})

describe('ImportExport – Import', () => {
  it('replaces the store data when a valid CapacityLens JSON file is loaded', async () => {
    render(<ImportExport />)

    const seedData = seed()
    const json = serializeData(seedData)
    const file = new File([json], 'capacitylens-data.json', { type: 'application/json' })

    const input = screen.getByTestId('import-input')

    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
    })

    fireEvent.change(input)

    // Allow the async file.text() + parse to settle, then confirm the replace.
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Replace data' }))

    expect(useStore.getState().data.resources.length).toBeGreaterThan(0)
    expect(useStore.getState().data.resources).toHaveLength(seedData.resources.length)
  })

  it('shows a confirmation summary and does NOT replace data until confirmed', async () => {
    useStore.getState().replaceAll(seed()) // existing data
    const before = useStore.getState().data.clients.length
    render(<ImportExport />)

    // Import a PARTIAL file (only the resources section) — it would replace the whole
    // active-account slice, so the user must confirm first; nothing is applied until then.
    const partial = JSON.stringify({
      schemaVersion: 2,
      data: {
        resources: [
          { id: 'r1', accountId: 'X', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#123456' },
        ],
      },
    })
    const file = new File([partial], 'partial.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The dialog is open and data is still intact (nothing applied yet).
    expect(screen.getByText(/replaces this company.s data/i)).toBeInTheDocument()
    expect(useStore.getState().data.clients).toHaveLength(before)

    // Cancelling leaves the data untouched.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useStore.getState().data.clients).toHaveLength(before)
  })

  it('import is undoable with ⌘Z (routes through the history stack)', async () => {
    // Active-account data: a non-empty import replaces the active account's slice (the
    // two added resources → the one imported), so ⌘Z restores the originals.
    useStore.getState().addResource(makeResourceDraft({ name: 'Alice' }))
    useStore.getState().addResource(makeResourceDraft({ name: 'Bob' }))
    const before = useStore.getState().data.resources.length
    render(<ImportExport />)

    const incoming = serializeData({
      ...emptyAppData(),
      resources: [{ ...makeResourceDraft({ name: 'Imported' }), id: 'imp-r', accountId: 'X', createdAt: 't', updatedAt: 't' }],
    })
    const file = new File([incoming], 'data.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Replace data' }))
    expect(useStore.getState().data.resources).toHaveLength(1) // replaced by the imported one

    useStore.getState().undo()
    expect(useStore.getState().data.resources).toHaveLength(before) // restored
  })

  it('shows an error (NOT an undo prompt) when an import drops every record', async () => {
    // A real prior edit, so there's an undo entry a wrongful "Press ⌘Z" prompt could target.
    useStore.getState().addClient({ name: 'Real Edit', color: '#111111' })
    render(<ImportExport />)

    // A CapacityLens-shaped file that PARSES (non-empty → dialog appears) but whose only record
    // dangles, so the store drops it and imported === 0 (no mutate, no undo entry pushed).
    const dangling = serializeData({
      ...emptyAppData(),
      allocations: [
        { id: 'a1', accountId: 'X', createdAt: 't', updatedAt: 't', resourceId: 'ghost', activityId: 'ghost', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      ],
    })
    const file = new File([dangling], 'dangling.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Replace data' })) // confirm the import

    const notice = useStore.getState().notice
    expect(notice?.message).toMatch(/no records imported/i)
    expect(notice?.message).not.toMatch(/undo/i) // must NOT lure the user into ⌘Z
    expect(notice?.tone).toBe('error')
    expect(useStore.getState().data.clients.map((c) => c.name)).toContain('Real Edit') // prior edit intact
  })

  it('rejects a CapacityLens-shaped file with zero records (no dialog, no wipe)', async () => {
    useStore.getState().replaceAll(seed()) // existing data that must NOT be wiped
    render(<ImportExport />)

    const file = new File([serializeData(emptyAppData())], 'empty.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // No confirmation dialog appears, an error notice naming the specific reason (empty CapacityLens
    // file → no records) is shown, and data is preserved.
    expect(screen.queryByRole('button', { name: 'Replace data' })).toBeNull()
    expect(useStore.getState().notice?.message).toMatch(/no CapacityLens records/i)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0)
  })

  it('surfaces a notice (and keeps the data) when the file is not valid CapacityLens JSON', async () => {
    useStore.getState().replaceAll(seed()) // existing data that must NOT be wiped
    render(<ImportExport />)

    const file = new File(['{ this is not json'], 'bad.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Invalid JSON now surfaces parseData's specific "That file isn't valid JSON." message.
    expect(useStore.getState().notice?.message).toMatch(/valid JSON/i)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0) // data preserved
  })
})

// Helper for the server-mode block: select a file and confirm the replace dialog.
async function importAndConfirm(json: string) {
  const file = new File([json], 'incoming.json', { type: 'application/json' })
  const input = screen.getByTestId('import-input')
  Object.defineProperty(input, 'files', { value: [file], writable: false })
  fireEvent.change(input)
  await new Promise((r) => setTimeout(r, 0))
  fireEvent.click(screen.getByRole('button', { name: 'Replace data' }))
}

describe('ImportExport – server mode (atomic /api/import, purge-gated)', () => {
  const incoming = () =>
    serializeData({
      ...emptyAppData(),
      resources: [{ ...makeResourceDraft({ name: 'Imported' }), id: 'imp-r', accountId: 'X', createdAt: 't', updatedAt: 't' }],
    })

  beforeEach(() => {
    serverFlag.on = true
  })

  it('keeps active-slice export available to editors without calling the admin endpoint', async () => {
    const fetchMock = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:editor'), revokeObjectURL: vi.fn() })
    render(
      <PermissionContext.Provider value={{ role: 'editor' }}>
        <ImportExport />
      </PermissionContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('export-data'))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('rejects an incomplete complete-export response instead of downloading it', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))
    render(
      <PermissionContext.Provider value={{ role: 'admin' }}>
        <ImportExport />
      </PermissionContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('export-data'))
    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'))
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('POSTs the parsed file to /api/import and reports the server counts WITHOUT an undo prompt', async () => {
    const before = useStore.getState().data
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ imported: 3, skipped: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/import')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as { accountId: string; data: { resources: unknown[] } }
    expect(body.accountId).toBe(useStore.getState().activeAccountId)
    expect(body.data.resources).toHaveLength(1)

    // The LOCAL store is never mutated by a server import (the server slice is the truth; the
    // re-hydrate is a no-op here — no persistence orchestrator is attached in tests).
    expect(useStore.getState().data).toBe(before)
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/imported 3 records/i))
    expect(useStore.getState().notice?.message).not.toMatch(/undo|⌘Z/i) // a server import is NOT undoable
  })

  it("surfaces the server's own error sentence on a non-OK response (e.g. the purge-gate 403)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Only an admin can import data.' }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/only an admin can import/i))
    expect(useStore.getState().notice?.tone).toBe('error')
  })

  it('a 200 with an off-spec body still re-hydrates and reports success — the server DID commit', async () => {
    // A shape error on a committed import must not be reported as "no records imported" (that
    // would skip the reload and leave the UI on pre-import data the server no longer holds).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>proxy mangled</html>', { status: 200 })),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/import complete/i))
    expect(useStore.getState().notice?.tone).not.toBe('error')
    expect(warn).toHaveBeenCalled() // breadcrumb for the off-spec body
    warn.mockRestore()
  })

  it('treats off-spec COUNTS (-1, 1.5, negatives) as a shape error — re-hydrate + plain success, never "-1 records"', async () => {
    // The counts are untrusted: a number that isn't a nonnegative safe integer must take the
    // off-spec committed-import path (breadcrumb + reload + numberless success), not the
    // success-notice path (nonsense) or the zero-record error path (a lie — the server committed).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ imported: -1, skipped: 1.5 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/import complete/i))
    expect(useStore.getState().notice?.tone).not.toBe('error')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a committed import whose re-hydrate FAILS reports the honest stale-view message, not success', async () => {
    // The import POST committed but the follow-up slice load broke: claiming "Imported 3 records"
    // over a view still rendering PRE-import data would be a lie — say both halves honestly.
    refreshOverride.value = 'failed'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ imported: 3, skipped: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/applied on the server.*couldn't be refreshed/i))
    expect(useStore.getState().notice?.tone).toBe('error')
    expect(useStore.getState().notice?.message).not.toMatch(/imported 3 records/i)
  })

  it('locks the UI while the import is in flight: blocking dialog + dirtyForm + disabled affordances', async () => {
    let resolveFetch: ((r: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    // POST held open — the non-dismissable "Importing…" dialog is up, the dirty-form semantics
    // arm the beforeunload/keyboard guards, and both affordances are disabled for the duration.
    await waitFor(() => expect(screen.getByTestId('import-busy')).toBeInTheDocument())
    expect(useStore.getState().dirtyForm).toBe(true)
    expect(screen.getByTestId('import-data')).toBeDisabled()
    expect(screen.getByTestId('export-data')).toBeDisabled()
    // Escape must NOT dismiss the lock — visibility is owned by importBusy alone.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('import-busy')).toBeInTheDocument()

    resolveFetch!(new Response(JSON.stringify({ imported: 1, skipped: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await waitFor(() => expect(screen.queryByTestId('import-busy')).not.toBeInTheDocument())
    expect(useStore.getState().dirtyForm).toBe(false)
    expect(screen.getByTestId('import-data')).not.toBeDisabled()
    expect(screen.getByTestId('export-data')).not.toBeDisabled()
  })

  it('a loss warning raised DURING the re-hydrate is not overwritten by the success notice', async () => {
    // The app holds one notice and a new one dismisses the old — the sticky parked-edit loss
    // warning must outrank "Imported N records" (the user can verify the import from the data;
    // they cannot re-discover a silently overwritten loss warning).
    refreshNotice.error = 'Your latest changes could not be saved — please re-apply them.'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ imported: 3, skipped: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'))
    // Give any (wrong) follow-up success notice a chance to land, then assert the warning held.
    await new Promise((r) => setTimeout(r, 10))
    expect(useStore.getState().notice?.message).toMatch(/could not be saved/i)
    expect(useStore.getState().notice?.message).not.toMatch(/imported 3 records/i)
  })

  it('a zero-record 200 UN-commits: the server refused the replace, so the parked-edit resume re-schedules (no drop)', async () => {
    // The server returns 200 {imported:0} WITHOUT replacing the slice (its replace is gated on
    // imported > 0). Treating that as committed made resume DROP a parked edit — destroying a
    // perfectly saveable edit over a replacement that never happened.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ imported: 0, skipped: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'))
    expect(resumeSpy.calls).toEqual([{ dropParkedEdits: false }])
  })

  it('a committed import resumes with dropParkedEdits (a parked pre-import edit must never re-save)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ imported: 3, skipped: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(resumeSpy.calls).toEqual([{ dropParkedEdits: true }]))
  })

  it('a NON-OK response resumes with re-schedule (nothing was replaced)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'nope' }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
      ),
    )

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(resumeSpy.calls).toEqual([{ dropParkedEdits: false }]))
  })

  it('reports a failed transport honestly (the import did not happen)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    render(<ImportExport />)
    await importAndConfirm(incoming())

    await waitFor(() => expect(useStore.getState().notice?.tone).toBe('error'))
  })

  it('reconciles an unknown timed-out import before resuming writes', async () => {
    refreshOverride.value = 'reloaded'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))
    render(<ImportExport />)
    await importAndConfirm(incoming())
    await waitFor(() => expect(resumeSpy.calls).toEqual([{ dropParkedEdits: true }]))
    expect(useStore.getState().notice?.message).toMatch(/latest server data was reloaded/i)
  })

  it('leaves writes suspended when a timed-out import cannot be reconciled', async () => {
    refreshOverride.value = 'failed'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))
    render(<ImportExport />)
    await importAndConfirm(incoming())
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/reload this page/i))
    expect(resumeSpy.calls).toEqual([])
  })

  it('hides the Import affordance from an editor (purge-tier, mirrors the server gate) but keeps Export', () => {
    render(
      <PermissionContext.Provider value={{ role: 'editor' }}>
        <ImportExport />
      </PermissionContext.Provider>,
    )
    expect(screen.queryByTestId('import-data')).toBeNull()
    expect(screen.getByTestId('export-data')).toBeInTheDocument()
  })

  it('keeps Import for an admin, and for a null role (OFF/demo/not-yet-fetched regression guard)', () => {
    const { unmount } = render(
      <PermissionContext.Provider value={{ role: 'admin' }}>
        <ImportExport />
      </PermissionContext.Provider>,
    )
    expect(screen.getByTestId('import-data')).toBeInTheDocument()
    unmount()
    render(<ImportExport />) // no provider → role null → importable (server 403 backstops)
    expect(screen.getByTestId('import-data')).toBeInTheDocument()
  })

  it('states the honest consequence in the confirm dialog: cannot be undone (no ⌘Z promise)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<ImportExport />)
    const file = new File([incoming()], 'incoming.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })
    fireEvent.change(input)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
    expect(screen.queryByText(/⌘Z/)).toBeNull()
  })
})
