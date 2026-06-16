import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeSignIn } from './FakeSignIn'
import { FAKE_USER } from '../lib/fakeAuth'

describe('FakeSignIn (cosmetic demo gate)', () => {
  it('renders the Google-style account chooser with the demo persona', () => {
    render(<FakeSignIn onSignIn={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Choose an account' })).toBeInTheDocument()
    expect(screen.getByText(FAKE_USER.name)).toBeInTheDocument()
    expect(screen.getByText(FAKE_USER.email)).toBeInTheDocument()
  })

  it('clicking the account calls onSignIn (no real auth, no popup)', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()
    render(<FakeSignIn onSignIn={onSignIn} />)
    await user.click(screen.getByTestId('fake-sign-in'))
    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it('"Use another account" also proceeds (not a dead control)', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()
    render(<FakeSignIn onSignIn={onSignIn} />)
    await user.click(screen.getByRole('button', { name: 'Use another account' }))
    expect(onSignIn).toHaveBeenCalledOnce()
  })
})
