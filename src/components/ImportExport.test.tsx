import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImportExport } from './ImportExport'
import { useStore } from '../store/useStore'
import { emptyAppData } from '../types/entities'
import { seed } from '../data/seed'
import { serializeData } from '../data/transfer'
import { makeResourceDraft, resetStoreWithAccount } from '../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().clearFilters()
})

describe('ImportExport – Export', () => {
  it('calls URL.createObjectURL, anchor.click, and URL.revokeObjectURL on export', () => {
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

    // Import a PARTIAL file (only one section) — must not silently wipe the rest.
    const partial = JSON.stringify({ schemaVersion: 2, data: { resources: [] } })
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
    // Single-account data owned by the active account: importing empty wipes the
    // active account's slice entirely, so raw data.resources goes to 0 (and ⌘Z
    // restores it). seed() spans two accounts, so importData would only clear one.
    useStore.getState().addResource(makeResourceDraft({ name: 'Alice' }))
    useStore.getState().addResource(makeResourceDraft({ name: 'Bob' }))
    const before = useStore.getState().data.resources.length
    render(<ImportExport />)

    const file = new File([serializeData(emptyAppData())], 'empty.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Replace data' }))
    expect(useStore.getState().data.resources).toHaveLength(0) // replaced

    useStore.getState().undo()
    expect(useStore.getState().data.resources).toHaveLength(before) // restored
  })

  it('surfaces a notice (and keeps the data) when the file is not valid Floaty JSON', async () => {
    useStore.getState().replaceAll(seed()) // existing data that must NOT be wiped
    render(<ImportExport />)

    const file = new File(['{ this is not json'], 'bad.json', { type: 'application/json' })
    const input = screen.getByTestId('import-input')
    Object.defineProperty(input, 'files', { value: [file], writable: false })

    fireEvent.change(input)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().notice).toMatch(/valid Floaty JSON/i)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0) // data preserved
  })
})
