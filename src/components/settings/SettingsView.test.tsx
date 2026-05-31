import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsView } from './SettingsView'
import { useStore } from '../../store/useStore'
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../../test/fixtures'

beforeEach(() => {
  resetStoreWithAccount()
  useStore.getState().setTheme('light')
})

describe('SettingsView — company name', () => {
  it('renames the active account through the store', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const input = screen.getByLabelText('Company name')
    expect(input).toHaveValue('Test Co')

    // No edit yet → Save is disabled.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Renamed Co')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const account = useStore.getState().data.accounts.find((a) => a.id === DEFAULT_ACCOUNT_ID)
    expect(account?.name).toBe('Renamed Co')
    expect(useStore.getState().notice?.message).toMatch(/updated/i)
  })

  it('rejects an empty name with a field error', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const input = screen.getByLabelText('Company name')
    await user.clear(input)
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(useStore.getState().data.accounts[0].name).toBe('Test Co')
  })
})

describe('SettingsView — theme', () => {
  it('reflects the current preference and switches it on click', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)

    const light = screen.getByRole('radio', { name: 'Light' })
    const dark = screen.getByRole('radio', { name: 'Dark' })
    expect(light).toHaveAttribute('aria-checked', 'true')
    expect(dark).toHaveAttribute('aria-checked', 'false')

    await user.click(dark)

    expect(useStore.getState().theme).toBe('dark')
    expect(dark).toHaveAttribute('aria-checked', 'true')
    // The choice is reflected onto <html> for the CSS to key off.
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
