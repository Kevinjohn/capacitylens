import { describe, it, expect } from 'vitest'
import { parseData, serializeData, MAX_IMPORT_RECORDS } from './transfer'
import { seed } from './seed'
import { EXPORT_SCHEMA_VERSION } from '../types/entities'

describe('data transfer', () => {
  it('round-trips through serialize -> parse (deep equal)', () => {
    const data = seed()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('rejects JSON that is not CapacityLens-shaped (so import never silently wipes data)', () => {
    expect(() => parseData('[1,2,3]')).toThrow()
    expect(() => parseData('{"data":5}')).toThrow()
    expect(() => parseData('5')).toThrow()
    expect(() => parseData('{"foo":"bar"}')).toThrow()
    expect(() => parseData('"hello"')).toThrow()
    expect(() => parseData('{"resources":"oops"}')).toThrow()
  })

  it('reports a known non-list table as damaged CapacityLens data', () => {
    expect(() =>
      parseData(JSON.stringify({ schemaVersion: EXPORT_SCHEMA_VERSION, data: { clients: {} } })),
    ).toThrow(/damaged: a data table is not a list/i)
  })

  it.each([
    ['string', String(10)],
    ['null', null],
    ['fractional', 1.5],
    ['negative', -1],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a present %s schema version before future data can be normalized away', (_label, schemaVersion) => {
    const json = JSON.stringify({
      schemaVersion,
      data: {
        clients: [{ id: 'c1', name: 'Recognised row' }],
        futureRecords: [{ id: 'would-be-lost' }],
      },
    })
    expect(() => parseData(json)).toThrow(/schema version must be a non-negative safe integer/i)
  })

  it('refuses a file with an absurd record count (JSON-bomb guard)', () => {
    const resources = Array.from({ length: MAX_IMPORT_RECORDS + 1 }, (_, i) => ({ id: `r${i}` }))
    expect(() => parseData(JSON.stringify({ schemaVersion: 3, data: { resources } }))).toThrow(/too many records/i)
  })

  it('refuses a CapacityLens-shaped file that contains zero records (would silently wipe the account)', () => {
    expect(() => parseData('{"accounts":[],"clients":[],"projects":[]}')).toThrow(/no CapacityLens records/i)
    expect(() => parseData(JSON.stringify({ schemaVersion: 3, data: { clients: [] } }))).toThrow(/no CapacityLens records/i)
  })

  it.each([
    ['null', null],
    ['string', 'not a record'],
    ['number', 42],
    ['array', []],
  ])('rejects a %s table element with a stable damaged-file error', (_label, row) => {
    expect(() => parseData(JSON.stringify({ clients: [row] }))).toThrow(
      'This file is damaged: the clients table contains an invalid record. Nothing was imported.',
    )
  })

  it('import tolerates a bare AppData and fills any missing arrays', () => {
    const json = JSON.stringify({
      clients: [{ id: 'c1', createdAt: 't', updatedAt: 't', name: 'A', color: '#1' }],
    })
    const out = parseData(json)
    expect(out.clients).toHaveLength(1)
    expect(out.resources).toEqual([])
    expect(out.allocations).toEqual([])
  })
})
