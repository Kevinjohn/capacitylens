import { describe, it, expect } from 'vitest'
import { getExternalExplainer } from './externalCopy'
import { m } from '@/i18n'

describe('externalExplainer', () => {
  it('resolves the External explainer through the shared i18n message', () => {
    const text = getExternalExplainer()
    expect(text).toBe(m.external_explainer())
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })
})
