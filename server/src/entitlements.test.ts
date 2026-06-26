import { describe, it, expect } from 'vitest'
import { entitlementsFor } from './entitlements'

// P1.16: the INERT default-unlimited entitlements seam (the control-plane swap point). Today every
// account is unlimited — there is NO billing, NO plan field, NO enforcement, and nothing on a route
// imports entitlementsFor. This pins the documented default so a future plan/quota lookup that swaps
// in behind entitlementsFor changes ONLY this function (and these expectations), nothing downstream.

describe('entitlementsFor (default-unlimited seam, P1.16)', () => {
  it('returns { unlimited: true } for any account id', () => {
    expect(entitlementsFor('acct-1')).toEqual({ unlimited: true })
    expect(entitlementsFor('anything')).toEqual({ unlimited: true })
  })
})
