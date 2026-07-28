import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('@capacitylens/shared package exports', () => {
  it('resolves the account barrel at its natural subpath', () => {
    const resolved = import.meta.resolve('@capacitylens/shared/account')

    expect(resolved).toMatch(/\/src\/account\/index\.ts$/)
    expect(existsSync(new URL(resolved))).toBe(true)
  })
})
