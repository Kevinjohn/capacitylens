import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteCompanyDialog } from './DeleteCompanyDialog'
import { makeAccount } from '../../test/fixtures'
import { useStore } from '../../store/useStore'
import { emptyAppData } from '../../types/entities'

// Friction on the one irreversible action: Delete stays disabled until the exact
// company name is typed.
beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData())
})

describe('DeleteCompanyDialog', () => {
  it('keeps Delete disabled until the typed name matches, then confirms', () => {
    const account = makeAccount({ name: 'Acme Co' })
    const onConfirm = vi.fn()
    render(<DeleteCompanyDialog account={account} onConfirm={onConfirm} onCancel={() => {}} />)

    const deleteBtn = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    expect(deleteBtn.disabled).toBe(true)

    const input = screen.getByLabelText(/Type/i)
    fireEvent.change(input, { target: { value: 'wrong' } })
    expect(deleteBtn.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'Acme Co' } })
    expect(deleteBtn.disabled).toBe(false)

    fireEvent.click(deleteBtn)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
