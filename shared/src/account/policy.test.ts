import { describe, expect, it } from 'vitest'
import type { Role } from './types'
import {
  canAdministerAccount,
  canAdministerIdentityAcrossWorkspaces,
  canManageMemberRole,
  canRemoveMember,
} from './policy'

const roles = (entries: Array<[string, Role]>): ReadonlyMap<string, Role> => new Map(entries)

describe('account administration policy', () => {
  it('keeps member/invitation administration at admin tier and transfer owner-only', () => {
    expect(canAdministerAccount('viewer', 'manage-members')).toBe(false)
    expect(canAdministerAccount('editor', 'manage-invitations')).toBe(false)
    expect(canAdministerAccount('admin', 'manage-members')).toBe(true)
    expect(canAdministerAccount('admin', 'transfer-ownership')).toBe(false)
    expect(canAdministerAccount('owner', 'transfer-ownership')).toBe(true)
  })

  it('keeps Owner outside ordinary role and removal operations', () => {
    expect(canManageMemberRole('owner', 'editor', 'admin')).toBe(true)
    expect(canManageMemberRole('owner', 'owner', 'admin')).toBe(false)
    expect(canManageMemberRole('owner', 'admin', 'owner')).toBe(false)
    expect(canRemoveMember('owner', 'owner')).toBe(false)
    expect(canRemoveMember('admin', 'editor')).toBe(true)
  })

  it('requires identity-administration standing in every target workspace', () => {
    expect(canAdministerIdentityAcrossWorkspaces(
      roles([['a', 'admin'], ['b', 'owner']]),
      roles([['a', 'editor'], ['b', 'admin']]),
      false,
    )).toBe(true)
    expect(canAdministerIdentityAcrossWorkspaces(
      roles([['a', 'admin']]),
      roles([['a', 'editor'], ['b', 'viewer']]),
      false,
    )).toBe(false)
    expect(canAdministerIdentityAcrossWorkspaces(
      roles([['a', 'admin'], ['b', 'admin']]),
      roles([['a', 'editor'], ['b', 'owner']]),
      false,
    )).toBe(false)
  })

  it('allows self-operation but fails closed for an identity with no memberships', () => {
    expect(canAdministerIdentityAcrossWorkspaces(
      roles([['a', 'viewer']]),
      roles([['a', 'viewer']]),
      true,
    )).toBe(true)
    expect(canAdministerIdentityAcrossWorkspaces(roles([]), roles([]), true)).toBe(false)
  })

  it('fails closed on unknown runtime values', () => {
    expect(canAdministerAccount('superuser' as Role, 'manage-members')).toBe(false)
    expect(canAdministerAccount('owner', 'unknown' as never)).toBe(false)
  })
})
