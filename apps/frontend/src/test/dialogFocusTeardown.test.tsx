import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

const onCloseAutoFocus = vi.fn()

// The two cases are order-dependent on purpose: the second observes what the shared teardown in
// setup.ts did after the first.
describe('shared teardown and dialog focus timers', () => {
  it('leaves an open dialog for the shared teardown to unmount', () => {
    render(
      <Dialog open>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Batcave access</DialogTitle>
          <DialogDescription>Confirm the change.</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    expect(onCloseAutoFocus).not.toHaveBeenCalled()
  })

  it('has already run the delayed focus return before the next test starts', () => {
    expect(onCloseAutoFocus).toHaveBeenCalledTimes(1)
  })
})
