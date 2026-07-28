import { describe, expect, it } from 'vitest'
import { selectsOnlyExplicitCoreSpecs } from '../scripts/playwright-server-scope'

describe('Playwright server scope', () => {
  it('recognises one or more explicitly selected core specs', () => {
    expect(
      selectsOnlyExplicitCoreSpecs([
        'node',
        'playwright',
        'test',
        'e2e/scheduler.spec.ts',
        'e2e/timeoff.spec.ts',
      ]),
    ).toBe(true)
  })

  it.each([
    ['an unfiltered run', ['node', 'playwright', 'test']],
    ['a directory selector', ['node', 'playwright', 'test', 'e2e']],
    [
      'a database-backed spec',
      ['node', 'playwright', 'test', 'e2e/persistence.db.spec.ts'],
    ],
    [
      'a mixed selection',
      [
        'node',
        'playwright',
        'test',
        'e2e/scheduler.spec.ts',
        'e2e/invite.auth.spec.ts',
      ],
    ],
  ])('retains the full server set for %s', (_label, argv) => {
    expect(selectsOnlyExplicitCoreSpecs(argv)).toBe(false)
  })
})
