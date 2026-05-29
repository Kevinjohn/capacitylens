import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImportExport } from './ImportExport'
import { useStore } from '../store/useStore'
import { emptyAppData } from '../types/entities'
import { seed } from '../data/seed'
import { serializeData } from '../data/transfer'

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
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

    // Allow the async file.text() + replaceAll to settle
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useStore.getState().data.resources.length).toBeGreaterThan(0)
    expect(useStore.getState().data.resources).toHaveLength(seedData.resources.length)
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
