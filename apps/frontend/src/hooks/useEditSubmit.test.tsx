import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlanningSaveCancelledError } from '@/data/planning/PlanningSaveCancelledError'
import { useEditSubmit } from './useEditSubmit'
import type { EditSubmitInput } from './useEditSubmit'

interface Row {
  id: string
  createdAt: string
  updatedAt: string
}

const row: Row = {
  id: 'gotham',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderSubmit(overrides: Partial<EditSubmitInput<Row>> = {}) {
  const input = {
    editing: row,
    rows: [row],
    staleMessage: () => 'Gotham changed.',
    fail: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  }
  const { result } = renderHook(() => useEditSubmit(input))
  return { input, result }
}

describe('useEditSubmit', () => {
  it('saves a fresh edit and reports it saved', async () => {
    const { input, result } = renderSubmit()
    const save = vi.fn(() => Promise.resolve())
    await act(() => result.current.submit(() => save))
    expect(save).toHaveBeenCalledOnce()
    expect(input.onSaved).toHaveBeenCalledOnce()
    expect(input.fail).not.toHaveBeenCalled()
  })

  it('refuses an edit whose row changed in the supplied rows without saving', async () => {
    const changed = { ...row, updatedAt: '2026-01-02T00:00:00.000Z' }
    const { input, result } = renderSubmit({ rows: [changed] })
    const save = vi.fn(() => Promise.resolve())
    await act(() => result.current.submit(() => save))
    expect(save).not.toHaveBeenCalled()
    expect(input.fail).toHaveBeenCalledWith(null, 'Gotham changed.')
    expect(input.onSaved).not.toHaveBeenCalled()
  })

  it('refuses an edit whose row vanished from the supplied rows', async () => {
    const { input, result } = renderSubmit({ rows: [] })
    const save = vi.fn(() => Promise.resolve())
    await act(() => result.current.submit(() => save))
    expect(save).not.toHaveBeenCalled()
    expect(input.fail).toHaveBeenCalledWith(null, 'Gotham changed.')
  })

  it('skips the stale check when creating', async () => {
    const { input, result } = renderSubmit({ editing: undefined, rows: [] })
    await act(() =>
      result.current.submit(() => () => Promise.resolve({ kind: 'created', value: row }))
    )
    expect(input.onSaved).toHaveBeenCalledOnce()
  })

  it('keeps the form open without an error when a create is blocked', async () => {
    const { input, result } = renderSubmit({ editing: undefined })
    await act(() => result.current.submit(() => () => Promise.resolve({ kind: 'blocked' })))
    expect(input.onSaved).not.toHaveBeenCalled()
    expect(input.fail).not.toHaveBeenCalled()
  })

  it('does not save when preparation reports a field error', async () => {
    const { input, result } = renderSubmit()
    await act(() => result.current.submit(() => null))
    expect(input.onSaved).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('ignores a second submit while the first save is in flight', async () => {
    const { input, result } = renderSubmit()
    let finish!: () => void
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    let first!: Promise<void>
    act(() => {
      first = result.current.submit(() => save)
    })
    expect(result.current.pending).toBe(true)
    await act(() => result.current.submit(() => save))
    expect(save).toHaveBeenCalledOnce()
    await act(async () => {
      finish()
      await first
    })
    expect(result.current.pending).toBe(false)
    expect(input.onSaved).toHaveBeenCalledOnce()
  })

  it('keeps the draft open without an error when the save is cancelled', async () => {
    const { input, result } = renderSubmit()
    await act(() =>
      result.current.submit(() => () => Promise.reject(new PlanningSaveCancelledError()))
    )
    expect(input.fail).not.toHaveBeenCalled()
    expect(input.onSaved).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('shows the form message for a cancelled save when one is given', async () => {
    const { input, result } = renderSubmit({
      cancelledMessage: (error) => `Gotham: ${error.message}`,
    })
    await act(() =>
      result.current.submit(() => () => Promise.reject(new PlanningSaveCancelledError()))
    )
    expect(input.fail).toHaveBeenCalledWith(null, 'Gotham: The planning save was cancelled.')
    expect(input.onSaved).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('shows a failed save on the form and reopens it for a retry', async () => {
    const { input, result } = renderSubmit()
    await act(() => result.current.submit(() => () => Promise.reject(new Error('Server down.'))))
    expect(input.fail).toHaveBeenCalledWith(null, 'Server down.')
    expect(input.onSaved).not.toHaveBeenCalled()
    const retry = vi.fn(() => Promise.resolve())
    await act(() => result.current.submit(() => retry))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('uses the form message for a rejection that is not an Error', async () => {
    const { input, result } = renderSubmit({ failedMessage: () => 'Could not save Gotham.' })
    await act(() => result.current.submit(() => () => Promise.reject(new Error('Server down.'))))
    expect(input.fail).toHaveBeenLastCalledWith(null, 'Server down.')
    await act(() => result.current.submit(() => () => Promise.reject('opaque')))
    expect(input.fail).toHaveBeenLastCalledWith(null, 'Could not save Gotham.')
  })
})
