import { describe, it, expect } from 'vitest'
import { newId } from './id'

describe('newId', () => {
  it('returns a v4-style uuid string', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('returns unique values', () => {
    expect(newId()).not.toBe(newId())
  })
})
