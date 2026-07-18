import { describe, expect, it } from 'vitest'
import {
  clearExternalSignInError,
  externalSignInErrorUrl,
  hasExternalSignInError,
} from './externalSignInError'

describe('external sign-in browser error URL', () => {
  it('marks the current route while preserving invitation state', () => {
    const marked = externalSignInErrorUrl('https://app.example/invite/token?source=mail')
    expect(marked).toBe('https://app.example/invite/token?source=mail&externalSignInError=1')
  })

  it('recognizes only marked provider failures and clears provider-controlled detail', () => {
    const failed = 'https://app.example/?externalSignInError=1&error=access_denied&error_description=secret&keep=1'
    expect(hasExternalSignInError(failed)).toBe(true)
    expect(hasExternalSignInError('https://app.example/?error=unrelated')).toBe(false)
    expect(clearExternalSignInError(failed)).toBe('https://app.example/?keep=1')
  })
})
