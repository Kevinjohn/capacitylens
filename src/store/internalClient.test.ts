import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import { internalClientFor } from '@floaty/shared/data/internalClient'

const s = () => useStore.getState()

describe('built-in Internal client in the store', () => {
  beforeEach(() => s().replaceAll(emptyAppData()))

  it('addAccount creates exactly one builtin Internal client for the new account', () => {
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    const internal = s().data.clients.filter((c) => c.builtin && c.accountId === a.id)
    expect(internal).toHaveLength(1)
    expect(internal[0].name).toBe('Internal')
    // A second account gets its OWN Internal (one per account).
    const b = s().addAccount({ name: 'Beta Co', color: '#111111' })
    expect(s().data.clients.filter((c) => c.builtin)).toHaveLength(2)
    expect(internalClientFor(s().data.clients, b.id)).toBeDefined()
  })

  it('rejects renaming the built-in Internal client', () => {
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    s().setActiveAccount(a.id)
    const internal = internalClientFor(s().data.clients, a.id)!
    expect(() => s().updateClient(internal.id, { name: 'Renamed' })).toThrow(/built in/i)
    // Unchanged.
    expect(internalClientFor(s().data.clients, a.id)!.name).toBe('Internal')
  })

  it('rejects deleting the built-in Internal client', () => {
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    s().setActiveAccount(a.id)
    const internal = internalClientFor(s().data.clients, a.id)!
    expect(() => s().deleteClient(internal.id)).toThrow(/built in/i)
    expect(internalClientFor(s().data.clients, a.id)).toBeDefined()
  })

  it('still allows renaming and deleting a normal client', () => {
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    s().setActiveAccount(a.id)
    const c = s().addClient({ name: 'Globex', color: '#3b82f6' })
    s().updateClient(c.id, { name: 'Globex 2' })
    expect(s().data.clients.find((x) => x.id === c.id)!.name).toBe('Globex 2')
    s().deleteClient(c.id)
    expect(s().data.clients.some((x) => x.id === c.id)).toBe(false)
  })

  it('addClient cannot create a SECOND builtin — the flag is stripped (one Internal per account)', () => {
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    s().setActiveAccount(a.id)
    // A cast payload smuggling builtin:true must NOT mint a second Internal — the store strips it.
    const c = s().addClient({ name: 'Sneaky', color: '#3b82f6', builtin: true } as never)
    expect(s().data.clients.find((x) => x.id === c.id)!.builtin).not.toBe(true)
    // Still exactly one builtin Internal for the account (addAccount's), not two.
    expect(s().data.clients.filter((x) => x.builtin && x.accountId === a.id)).toHaveLength(1)
  })

  it('updateClient cannot PROMOTE a normal client to a builtin — the flag is stripped', () => {
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    s().setActiveAccount(a.id)
    const c = s().addClient({ name: 'Globex', color: '#3b82f6' })
    s().updateClient(c.id, { builtin: true } as never)
    expect(s().data.clients.find((x) => x.id === c.id)!.builtin).not.toBe(true)
    // No second builtin appeared for the account.
    expect(s().data.clients.filter((x) => x.builtin && x.accountId === a.id)).toHaveLength(1)
  })
})
