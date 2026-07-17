import { describe, expect, it } from 'vitest'
import { joinedAccountEntryPath, readJoinedAccountHandoff } from './joinedAccountHandoff'

describe('joined account handoff', () => {
  it('round-trips an opaque account id through the one-use entry query', () => {
    const path = joinedAccountEntryPath('account / one')
    expect(path).toBe('/?joinedAccount=account%20%2F%20one')
    expect(readJoinedAccountHandoff(path.slice(path.indexOf('?')))).toBe('account / one')
  })

  it('ignores missing and empty destinations', () => {
    expect(readJoinedAccountHandoff('')).toBeNull()
    expect(readJoinedAccountHandoff('?joinedAccount=')).toBeNull()
  })
})
