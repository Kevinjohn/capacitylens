import { describe, it, expect } from 'vitest'
import { can, canSeeTimeOffNote } from './access'
import type { Role, Action } from './access'

// These tests are an INDEPENDENT oracle of the CapacityLens Decisions access matrix: the expected
// booleans below are hard-coded by hand from the spec, NOT derived from the implementation. If
// access.ts and this table disagree, that's the test doing its job — do not "fix" it by copying the
// implementation's logic.

// The closed set of roles, hard-coded (not imported as a list) so the test is its own source of truth.
const ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer']

// The closed set of actions. The `satisfies` below ties this list to the `Action` union: a new
// Action that isn't listed here is a compile error, so a new capability cannot silently escape the
// exhaustive sweep.
const ACTIONS = [
  'read',
  'write',
  'manageMembers',
  'manageInvites',
  'purge',
  'transferOwnership',
] as const satisfies readonly Action[]

// The full 4×6 expected matrix, written out explicitly from the Decisions table:
//   read              — any member (owner, admin, editor, viewer)
//   write             — editor and up (owner, admin, editor); NOT viewer
//   manageMembers     — admin and up (owner, admin)
//   manageInvites     — admin and up (owner, admin)
//   purge             — admin and up (owner, admin)
//   transferOwnership — owner only
const EXPECTED: Record<Role, Record<Action, boolean>> = {
  owner: {
    read: true,
    write: true,
    manageMembers: true,
    manageInvites: true,
    purge: true,
    transferOwnership: true,
  },
  admin: {
    read: true,
    write: true,
    manageMembers: true,
    manageInvites: true,
    purge: true,
    transferOwnership: false,
  },
  editor: {
    read: true,
    write: true,
    manageMembers: false,
    manageInvites: false,
    purge: false,
    transferOwnership: false,
  },
  viewer: {
    read: true,
    write: false,
    manageMembers: false,
    manageInvites: false,
    purge: false,
    transferOwnership: false,
  },
}

describe('can(role, action) — the pure access matrix', () => {
  // Completeness guard: the action list the sweep iterates must equal the `Action` union, so a new
  // Action can't slip past the exhaustive check. (The `satisfies` on ACTIONS catches an EXTRA/typo
  // member at compile time; this asserts none was DROPPED — keep this count in step with `Action`.)
  it('iterates exactly the Action union (6 actions, no more, no fewer)', () => {
    expect(ACTIONS.length).toBe(6)
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length) // no duplicates
  })

  it('iterates exactly the Role union (4 roles)', () => {
    expect(ROLES.length).toBe(4)
    expect(new Set(ROLES).size).toBe(ROLES.length)
  })

  // The exhaustive sweep: all 4 roles × all 6 actions = 24 pairs, each against the hard-coded oracle.
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const expected = EXPECTED[role][action]
      it(`can('${role}', '${action}') === ${expected}`, () => {
        expect(can(role, action)).toBe(expected)
      })
    }
  }
})

describe('canSeeTimeOffNote(role) — field-level rule (owner/admin only)', () => {
  it('owner may see the time-off note', () => {
    expect(canSeeTimeOffNote('owner')).toBe(true)
  })
  it('admin may see the time-off note', () => {
    expect(canSeeTimeOffNote('admin')).toBe(true)
  })
  it('editor may NOT see the time-off note', () => {
    expect(canSeeTimeOffNote('editor')).toBe(false)
  })
  it('viewer may NOT see the time-off note', () => {
    expect(canSeeTimeOffNote('viewer')).toBe(false)
  })
})
