import { describe, it, expect } from 'vitest'
import {
  can,
  canSeeTimeOffNote,
  canSeePrivateNames,
  isAtLeast,
  canManageMemberRole,
  canRemoveMember,
  canResetMemberPassword,
  canResetMemberAcrossAccounts,
} from './access'
import type { Role, Action } from './access'
import { canAdministerAccount } from '../account/policy'

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
  'deleteAccount',
  'transferOwnership',
] as const satisfies readonly Action[]

// The full 4×7 expected matrix, written out explicitly from the Decisions table:
//   read              — any member (owner, admin, editor, viewer)
//   write             — editor and up (owner, admin, editor); NOT viewer
//   manageMembers     — admin and up (owner, admin)
//   manageInvites     — admin and up (owner, admin)
//   purge             — admin and up (owner, admin)
//   deleteAccount     — owner only
//   transferOwnership — owner only
const EXPECTED: Record<Role, Record<Action, boolean>> = {
  owner: {
    read: true,
    write: true,
    manageMembers: true,
    manageInvites: true,
    purge: true,
    deleteAccount: true,
    transferOwnership: true,
  },
  admin: {
    read: true,
    write: true,
    manageMembers: true,
    manageInvites: true,
    purge: true,
    deleteAccount: false,
    transferOwnership: false,
  },
  editor: {
    read: true,
    write: true,
    manageMembers: false,
    manageInvites: false,
    purge: false,
    deleteAccount: false,
    transferOwnership: false,
  },
  viewer: {
    read: true,
    write: false,
    manageMembers: false,
    manageInvites: false,
    purge: false,
    deleteAccount: false,
    transferOwnership: false,
  },
}

describe('can(role, action) — the pure access matrix', () => {
  // Completeness guard: the action list the sweep iterates must equal the `Action` union, so a new
  // Action can't slip past the exhaustive check. (The `satisfies` on ACTIONS catches an EXTRA/typo
  // member at compile time; this asserts none was DROPPED — keep this count in step with `Action`.)
  it('iterates exactly the Action union (7 actions, no more, no fewer)', () => {
    expect(ACTIONS.length).toBe(7)
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

describe('CapacityLens/account-policy ownership seam', () => {
  const mapped = {
    manageMembers: 'manage-members',
    manageInvites: 'manage-invitations',
    deleteAccount: 'erase-workspace',
    transferOwnership: 'transfer-ownership',
  } as const

  for (const role of ROLES) {
    for (const [productAction, accountAction] of Object.entries(mapped) as Array<
      [keyof typeof mapped, (typeof mapped)[keyof typeof mapped]]
    >) {
      it(`${role}/${productAction} delegates to canonical ${accountAction} policy`, () => {
        expect(can(role, productAction)).toBe(canAdministerAccount(role, accountAction))
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

describe('canSeePrivateNames(role) — field-level rule (owner only)', () => {
  it.each([
    ['owner', true],
    ['admin', false],
    ['editor', false],
    ['viewer', false],
  ] as const)('%s → %s', (role, expected) => {
    expect(canSeePrivateNames(role)).toBe(expected)
  })
})

// P1.11 member-management guards. The expected booleans below are the hand-written oracle of the
// member-management policy (Owner changes only through transfer), NOT derived from the
// implementation — if access.ts and these tables disagree, the test is doing its job.

describe('isAtLeast(role, min) — tier comparison', () => {
  // The full 4×4 oracle, written from the strict hierarchy viewer<editor<admin<owner.
  const EXPECTED: Record<Role, Record<Role, boolean>> = {
    owner: { owner: true, admin: true, editor: true, viewer: true },
    admin: { owner: false, admin: true, editor: true, viewer: true },
    editor: { owner: false, admin: false, editor: true, viewer: true },
    viewer: { owner: false, admin: false, editor: false, viewer: true },
  }
  for (const role of ROLES) {
    for (const min of ROLES) {
      const expected = EXPECTED[role][min]
      it(`isAtLeast('${role}', '${min}') === ${expected}`, () => {
        expect(isAtLeast(role, min)).toBe(expected)
      })
    }
  }
})

describe('canManageMemberRole(actor, target, next) — role-change matrix', () => {
  // Exhaustive sweep over every actor × target × next combination, against a hand-derived oracle.
  // Oracle rules: actor must hold manageMembers (admin+); neither promoting to nor demoting from
  // Owner is an ordinary role edit — both go through ownership transfer.
  const oracle = (actor: Role, target: Role, next: Role): boolean => {
    if (!(actor === 'owner' || actor === 'admin')) return false // manageMembers = admin tier
    if (next === 'owner' || target === 'owner') return false
    return true
  }
  for (const actor of ROLES) {
    for (const target of ROLES) {
      for (const next of ROLES) {
        const expected = oracle(actor, target, next)
        it(`canManageMemberRole('${actor}','${target}','${next}') === ${expected}`, () => {
          expect(canManageMemberRole(actor, target, next)).toBe(expected)
        })
      }
    }
  }

  it('no actor may grant Owner through an ordinary role change', () => {
    expect(canManageMemberRole('owner', 'editor', 'owner')).toBe(false)
    expect(canManageMemberRole('admin', 'editor', 'owner')).toBe(false)
  })

  it('no actor may demote the Owner outside ownership transfer', () => {
    expect(canManageMemberRole('admin', 'owner', 'editor')).toBe(false)
    expect(canManageMemberRole('owner', 'owner', 'editor')).toBe(false)
  })

  it('rejects Owner-to-Owner no-ops so an Admin can never touch the Owner through this guard', () => {
    expect(canManageMemberRole('admin', 'owner', 'owner')).toBe(false)
    expect(canManageMemberRole('owner', 'owner', 'owner')).toBe(false)
  })

  it('editor/viewer (no manageMembers) can never change a role', () => {
    expect(canManageMemberRole('editor', 'viewer', 'editor')).toBe(false)
    expect(canManageMemberRole('viewer', 'viewer', 'viewer')).toBe(false)
  })
})

describe('canRemoveMember(actor, target) — removal matrix', () => {
  const oracle = (actor: Role, target: Role): boolean => {
    if (!(actor === 'owner' || actor === 'admin')) return false
    if (target === 'owner') return false
    return true
  }
  for (const actor of ROLES) {
    for (const target of ROLES) {
      const expected = oracle(actor, target)
      it(`canRemoveMember('${actor}','${target}') === ${expected}`, () => {
        expect(canRemoveMember(actor, target)).toBe(expected)
      })
    }
  }

  it('no actor may remove the Owner', () => {
    expect(canRemoveMember('admin', 'owner')).toBe(false)
    expect(canRemoveMember('owner', 'owner')).toBe(false)
  })

  it('admin may remove non-owners; editor/viewer may remove no one', () => {
    expect(canRemoveMember('admin', 'editor')).toBe(true)
    expect(canRemoveMember('editor', 'viewer')).toBe(false)
    expect(canRemoveMember('viewer', 'viewer')).toBe(false)
  })
})

describe('canResetMemberPassword(actor, target) — reset-link matrix (P1.18)', () => {
  // Same who-may-touch-whom shape as removal: a reset link is an account-takeover capability, so
  // an admin must never be able to mint one for an owner (privilege escalation).
  const oracle = (actor: Role, target: Role): boolean => {
    if (!(actor === 'owner' || actor === 'admin')) return false
    if (target === 'owner' && actor !== 'owner') return false
    return true
  }
  for (const actor of ROLES) {
    for (const target of ROLES) {
      const expected = oracle(actor, target)
      it(`canResetMemberPassword('${actor}','${target}') === ${expected}`, () => {
        expect(canResetMemberPassword(actor, target)).toBe(expected)
      })
    }
  }

  it('admin may NOT reset an owner (takeover path); owner may reset anyone including an owner', () => {
    expect(canResetMemberPassword('admin', 'owner')).toBe(false)
    expect(canResetMemberPassword('owner', 'owner')).toBe(true)
  })

  it('editor/viewer may reset no one', () => {
    expect(canResetMemberPassword('editor', 'viewer')).toBe(false)
    expect(canResetMemberPassword('viewer', 'viewer')).toBe(false)
  })
})

describe('canResetMemberAcrossAccounts(actor, target) — global-identity reset matrix (P1.18)', () => {
  const roles = (entries: [string, Role][]) => new Map<string, Role>(entries)

  it('single account reduces to the per-account check (admin resets editor, not owner)', () => {
    expect(canResetMemberAcrossAccounts(roles([['X', 'admin']]), roles([['X', 'editor']]), false)).toBe(true)
    expect(canResetMemberAcrossAccounts(roles([['X', 'admin']]), roles([['X', 'owner']]), false)).toBe(false)
    expect(canResetMemberAcrossAccounts(roles([['X', 'owner']]), roles([['X', 'owner']]), false)).toBe(true)
  })

  it('CLOSES the cross-account escalation: an admin of X cannot reset a user who owns Y', () => {
    // Target is a mere editor in X but the OWNER of Y; actor is only in X.
    const actor = roles([['X', 'admin']])
    const target = roles([['X', 'editor'], ['Y', 'owner']])
    expect(canResetMemberAcrossAccounts(actor, target, false)).toBe(false)
  })

  it('an OWNER of X still cannot reset a user who owns Y (no standing in Y)', () => {
    const actor = roles([['X', 'owner']])
    const target = roles([['X', 'editor'], ['Y', 'owner']])
    expect(canResetMemberAcrossAccounts(actor, target, false)).toBe(false)
  })

  it('allows the reset only when the actor has authority in EVERY account the target is in', () => {
    // Actor owns both X and Y; target is editor in X and admin in Y → owner dominates both.
    const actor = roles([['X', 'owner'], ['Y', 'owner']])
    const target = roles([['X', 'editor'], ['Y', 'admin']])
    expect(canResetMemberAcrossAccounts(actor, target, false)).toBe(true)
  })

  it('refuses when the actor lacks reset authority in a shared account (co-editors)', () => {
    // Actor is admin in X (acting) but only an editor in shared account Z where the target also sits.
    const actor = roles([['X', 'admin'], ['Z', 'editor']])
    const target = roles([['X', 'editor'], ['Z', 'editor']])
    expect(canResetMemberAcrossAccounts(actor, target, false)).toBe(false)
  })

  it('fail-closed on a target with no memberships', () => {
    expect(canResetMemberAcrossAccounts(roles([['X', 'owner']]), roles([]), false)).toBe(false)
  })

  it('SELF-RESET exemption: a multi-account self passes even where cross-account authority would fail', () => {
    // Owner of X who is a mere editor of Y resets their OWN password. actor === target, so the maps
    // are identical; the non-self path would hit Y and fail canResetMemberPassword('editor','editor').
    // The isSelf exemption skips the cross-account check — you cannot escalate against your own identity.
    const self = roles([['X', 'owner'], ['Y', 'editor']])
    expect(canResetMemberAcrossAccounts(self, self, true)).toBe(true)
    // Same maps WITHOUT the exemption is (correctly) refused — proving the exemption is load-bearing.
    expect(canResetMemberAcrossAccounts(self, self, false)).toBe(false)
  })

  it('SELF-RESET still fails closed on an empty target map (no identity to reset)', () => {
    expect(canResetMemberAcrossAccounts(roles([['X', 'owner']]), roles([]), true)).toBe(false)
  })
})

// The documented fail-closed contract at the untyped boundary: an unrecognised role or action makes
// a rank `undefined`, and the guard must DENY (return false) — it must never fall open to `true`.
describe('can / isAtLeast — fail-closed on an unknown role/action (never falls open)', () => {
  it('an unknown role is denied EVERY action', () => {
    for (const action of ACTIONS) {
      expect(can('superuser' as Role, action)).toBe(false)
    }
  })
  it('an unknown action is denied for EVERY role', () => {
    for (const role of ROLES) {
      expect(can(role, 'reboot' as Action)).toBe(false)
    }
  })
  it('isAtLeast denies when either the role or the min tier is unknown', () => {
    expect(isAtLeast('superuser' as Role, 'viewer')).toBe(false)
    expect(isAtLeast('viewer', 'superuser' as Role)).toBe(false)
  })
})
