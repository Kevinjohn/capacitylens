import { describe, it, expect, afterEach, vi } from 'vitest'
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

  describe('when crypto.randomUUID is unavailable', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('throws the documented newId() message when crypto itself is absent', () => {
      vi.stubGlobal('crypto', undefined)
      // A mutant that guts the guard (e.g. `if (false)`, or short-circuits the `||`
      // so the second half never runs) skips the throw and instead lets
      // `crypto.randomUUID()` blow up with an unrelated native TypeError — this
      // message match only survives on the real, intended guard.
      expect(() => newId()).toThrow(
        /^newId\(\): crypto\.randomUUID is unavailable\. CapacityLens needs a secure context/,
      )
    })

    it('throws the same documented message when crypto exists but has no randomUUID', () => {
      vi.stubGlobal('crypto', {})
      expect(() => newId()).toThrow(
        /^newId\(\): crypto\.randomUUID is unavailable\. CapacityLens needs a secure context/,
      )
    })
  })
})
