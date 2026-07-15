import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const enable = vi.fn()
const verifyTotp = vi.fn()
vi.mock('./authClient', () => ({
  authClient: {
    twoFactor: {
      enable: (...args: unknown[]) => enable(...args),
      verifyTotp: (...args: unknown[]) => verifyTotp(...args),
    },
  },
}))

import { MfaEnrollmentScreen } from './MfaEnrollmentScreen'

beforeEach(() => {
  enable.mockReset()
  verifyTotp.mockReset()
})

describe('MfaEnrollmentScreen', () => {
  it('requires recovery-code acknowledgement and a verified TOTP before opening tenant data', async () => {
    enable.mockResolvedValue({
      data: {
        totpURI: 'otpauth://totp/CapacityLens:test?secret=ABCDEF&issuer=CapacityLens',
        backupCodes: ['recovery-one', 'recovery-two'],
      },
      error: null,
    })
    verifyTotp.mockResolvedValue({ data: { status: true }, error: null })
    const onEnrolled = vi.fn()
    render(<MfaEnrollmentScreen onEnrolled={onEnrolled} onSignOut={vi.fn()} />)

    fireEvent.change(screen.getByTestId('mfa-enroll-password'), { target: { value: 'current-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('recovery-one')).toBeInTheDocument()
    expect(screen.getByText('recovery-two')).toBeInTheDocument()
    expect(enable).toHaveBeenCalledWith({ password: 'current-password', issuer: 'CapacityLens' })

    const submit = screen.getByTestId('mfa-enroll-submit')
    fireEvent.change(screen.getByTestId('mfa-enroll-code'), { target: { value: '123456' } })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /stored the recovery codes/i }))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(onEnrolled).toHaveBeenCalledTimes(1))
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: false })
  })

  it('keeps the enrollment wall closed and surfaces an authentication failure', async () => {
    enable.mockResolvedValue({ data: null, error: { message: 'Current password is incorrect.' } })
    const onEnrolled = vi.fn()
    render(<MfaEnrollmentScreen onEnrolled={onEnrolled} onSignOut={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.')
    expect(onEnrolled).not.toHaveBeenCalled()
  })
})
