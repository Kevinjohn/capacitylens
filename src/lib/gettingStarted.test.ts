import { describe, it, expect } from 'vitest'
import { deriveGettingStartedSteps, allStepsDone } from './gettingStarted'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { FIXTURE_CLIENT, FIXTURE_PROJECT, FIXTURE_RESOURCE, FIXTURE_ALLOCATION } from '@capacitylens/shared/data/fixtures'
import type { AppData } from '@capacitylens/shared/types/entities'

// Pure derivation tests only — the card's render/visibility rules (dismissed flag, all-done,
// viewer role) ride on the store and are exercised end-to-end in e2e/getting-started.spec.ts.

const NOW = '2026-06-03T12:00:00.000Z'

/** A fresh AppData with the given slices; the derivation reads only presence, so spreading the
 *  canonical fixtures (shared/src/data/fixtures.ts) — the repo's drift-proofed source of a
 *  fully-valid entity — is enough. */
function dataWith(slices: Partial<AppData>): AppData {
  return { ...emptyAppData(), ...slices }
}

describe('deriveGettingStartedSteps', () => {
  it('reports nothing done on an empty account', () => {
    expect(deriveGettingStartedSteps(emptyAppData())).toEqual({
      client: false,
      project: false,
      person: false,
      assign: false,
    })
  })

  it('does NOT count the built-in Internal client as "your first client"', () => {
    const data = dataWith({ clients: [buildInternalClient('a1', NOW)] })
    expect(deriveGettingStartedSteps(data).client).toBe(false)
  })

  it('counts a real (non-builtin) client', () => {
    const data = dataWith({
      clients: [buildInternalClient('a1', NOW), { ...FIXTURE_CLIENT, builtin: false }],
    })
    expect(deriveGettingStartedSteps(data).client).toBe(true)
  })

  it('ticks each remaining step off its own slice', () => {
    const data = dataWith({
      projects: [FIXTURE_PROJECT],
      resources: [FIXTURE_RESOURCE],
      allocations: [FIXTURE_ALLOCATION],
    })
    expect(deriveGettingStartedSteps(data)).toEqual({
      client: false,
      project: true,
      person: true,
      assign: true,
    })
  })
})

describe('allStepsDone', () => {
  it('is true only when every step is complete', () => {
    expect(allStepsDone({ client: true, project: true, person: true, assign: true })).toBe(true)
  })

  it.each([
    ['client', { client: false, project: true, person: true, assign: true }],
    ['project', { client: true, project: false, person: true, assign: true }],
    ['person', { client: true, project: true, person: false, assign: true }],
    ['assign', { client: true, project: true, person: true, assign: false }],
  ] as const)('is false when %s is incomplete', (_label, steps) => {
    expect(allStepsDone(steps)).toBe(false)
  })
})
