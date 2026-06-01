import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImportExport } from './ImportExport'
import { useStore } from '../store/useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import { seed } from '@floaty/shared/data/seed'
import { serializeData } from '@floaty/shared/data/transfer'
import { makeResourceDraft, resetStoreWithAccount } from '../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
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
  it('replaces the store data when a valid Floaty JSON file is loaded', async () => {
    render(<ImportExport />)

    const seedData = seed()
    const json = serializeData(seedData)
    const file = new File([json], 'floaty-data.json', { type: 'application/json' })

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

    // A Floaty-shaped file that PARSES (non-empty → dialog appears) but whose only record
    // dangles, so the store drops it and imported === 0 (no mutate, no undo entry pushed).
    const dangling = serializeData({
      ...emptyAppData(),
      allocations: [
        { id: 'a1', accountId: 'X', createdAt: 't', updatedAt: 't', resourceId: 'ghost', taskId: 'ghost', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
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

  it('rejects a Floaty-shaped file with zero records (no dialog, no wipe)', async () => {
    useStore.getState().replaceAll(seed()) // existing data that must NOT be wiped
    render(<ImportExport />)

    const file = new File([serializeData(emptyAppData())], 'empty.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // No confirmation dialog appears, an error notice is shown, and data is preserved.
    expect(screen.queryByRole('button', { name: 'Replace data' })).toBeNull()
    expect(useStore.getState().notice?.message).toMatch(/valid Floaty JSON/i)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0)
  })

  it('surfaces a notice (and keeps the data) when the file is not valid Floaty JSON', async () => {
    useStore.getState().replaceAll(seed()) // existing data that must NOT be wiped
    render(<ImportExport />)

    const file = new File(['{ this is not json'], 'bad.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().notice?.message).toMatch(/valid Floaty JSON/i)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0) // data preserved
  })
})
