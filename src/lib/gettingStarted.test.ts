import { describe, it, expect } from 'vitest'
import { deriveGettingStartedSteps } from './gettingStarted'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import type { AppData, Client, Project, Resource, Allocation } from '@capacitylens/shared/types/entities'

// Pure derivation tests only — the card's render/visibility rules (dismissed flag, all-done,
// viewer role) ride on the store and are exercised end-to-end in e2e/getting-started.spec.ts.

const NOW = '2026-06-03T12:00:00.000Z'

/** A fresh AppData with the given slices; the derivation reads only presence, so minimal
 *  entity stubs (cast) are enough — full field validity is the fixtures'/store's concern. */
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
      clients: [buildInternalClient('a1', NOW), { id: 'c1', builtin: false } as Client],
    })
    expect(deriveGettingStartedSteps(data).client).toBe(true)
  })

  it('ticks each remaining step off its own slice', () => {
    const data = dataWith({
      projects: [{ id: 'p1' } as Project],
      resources: [{ id: 'r1' } as Resource],
      allocations: [{ id: 'al1' } as Allocation],
    })
    expect(deriveGettingStartedSteps(data)).toEqual({
      client: false,
      project: true,
      person: true,
      assign: true,
    })
  })
})
