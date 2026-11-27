import { describe, expect, it } from 'vitest'
import { makeCompany, makeAppData, makeClient } from '@/test/fixtures'
import { applyReceiptChanges } from './planningReceiptChanges'

const wayne = makeClient({ id: 'client-wayne', companyId: 'wayne', name: 'Wayne Enterprises' })
const kord = makeClient({ id: 'client-kord', companyId: 'wayne', name: 'Kord Industries' })
const data = makeAppData({ companies: [makeCompany({ id: 'wayne' })], clients: [wayne, kord] })

describe('applyReceiptChanges', () => {
  it('appends an upsert with a new id', () => {
    const ferris = makeClient({ id: 'client-ferris', companyId: 'wayne', name: 'Ferris Aircraft' })
    const next = applyReceiptChanges(data, {
      upserts: [{ entity: 'clients', row: ferris }],
      removed: [],
    })
    expect(next.clients).toEqual([wayne, kord, ferris])
  })

  it('replaces the row an upsert names by id', () => {
    const renamed = { ...kord, name: 'Kord Omniversal' }
    const next = applyReceiptChanges(data, {
      upserts: [{ entity: 'clients', row: renamed }],
      removed: [],
    })
    expect(next.clients).toEqual([wayne, renamed])
  })

  it('drops a removed id', () => {
    const next = applyReceiptChanges(data, {
      upserts: [],
      removed: [{ entity: 'clients', id: wayne.id }],
    })
    expect(next.clients).toEqual([kord])
  })

  it('keeps the array identity of every entity the write did not touch', () => {
    const next = applyReceiptChanges(data, {
      upserts: [],
      removed: [{ entity: 'clients', id: wayne.id }],
    })
    expect(next.companies).toBe(data.companies)
    expect(next.projects).toBe(data.projects)
    expect(next.clients).not.toBe(data.clients)
    expect(data.clients).toEqual([wayne, kord])
  })
})
