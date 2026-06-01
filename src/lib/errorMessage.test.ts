import { describe, it, expect } from 'vitest'
import { errorMessage } from './errorMessage'

describe('errorMessage', () => {
  it('normalises an Error, a string, a React Router ErrorResponse, and unknown throws', () => {
    expect(errorMessage(new Error('x'))).toBe('x')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage({ statusText: 'Not Found' })).toBe('Not Found')
    expect(errorMessage(null)).toBe('An unexpected error occurred.')
    expect(errorMessage(42)).toBe('An unexpected error occurred.')
  })
})
