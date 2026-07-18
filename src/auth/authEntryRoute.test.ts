import { describe, expect, it } from 'vitest'
import { publicAuthEntryForPath } from './authEntryRoute'

describe('publicAuthEntryForPath', () => {
  it.each([
    ['/reset-password/token', 'password-reset'],
    ['/invite/token', 'invitation'],
    ['/reset-password/', null],
    ['/invite/', null],
    ['/invite/token/extra', null],
    ['/settings', null],
  ] as const)('classifies %s', (pathname, expected) => {
    expect(publicAuthEntryForPath(pathname)).toBe(expected)
  })
})
