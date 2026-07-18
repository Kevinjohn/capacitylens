import { describe, expect, it } from 'vitest'
import { boundApplicationFailure } from './validation'

const validApplication = {
  applicationId: 'sibling_app',
  displayName: 'Sibling App',
  branding: {
    totpIssuer: 'Sibling App',
    defaultProviderLabel: 'Single sign-on',
    passwordContextWords: ['sibling', 'product'],
  },
}

describe('boundApplicationFailure', () => {
  it('accepts a complete provider-neutral application binding', () => {
    expect(boundApplicationFailure(validApplication)).toBeNull()
  })

  it.each([
    [{ ...validApplication, applicationId: '../other' }, 'application id'],
    [{ ...validApplication, displayName: '   ' }, 'display name'],
    [{ ...validApplication, branding: { ...validApplication.branding, totpIssuer: '' } }, 'branding'],
    [{ ...validApplication, branding: { ...validApplication.branding, passwordContextWords: [''] } }, 'branding'],
  ])('rejects invalid binding %#', (application, message) => {
    expect(boundApplicationFailure(application)).toContain(message)
  })
})
