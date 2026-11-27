import { loadPlanningData } from '@/test/fixtures'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormButtons } from './ui'
import { useStore } from '@/store/useStore'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'

beforeEach(() => {
  loadPlanningData(createEmptyAppData())
  useStore.getState().clearFilters()
  useStore.getState().setDirtyForm(false)
})

describe('FormButtons', () => {
  it('renders the standard actions and supports a submit-label override', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <form>
        <FormButtons onCancel={onCancel} submitLabel="Create" />
      </form>
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute('type', 'submit')
  })
})
