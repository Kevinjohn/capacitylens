import { describe, it, expect } from 'vitest'
import { parseData, serializeData, MAX_IMPORT_RECORDS } from './transfer'
import { seed } from './seed'

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

  it('refuses a file with an absurd record count (JSON-bomb guard)', () => {
    const resources = Array.from({ length: MAX_IMPORT_RECORDS + 1 }, (_, i) => ({ id: `r${i}` }))
    expect(() => parseData(JSON.stringify({ schemaVersion: 3, data: { resources } }))).toThrow(/too many records/i)
  })

  it('refuses a CapacityLens-shaped file that contains zero records (would silently wipe the account)', () => {
    expect(() => parseData('{"accounts":[],"clients":[],"projects":[]}')).toThrow(/no CapacityLens records/i)
    expect(() => parseData(JSON.stringify({ schemaVersion: 3, data: { clients: [] } }))).toThrow(/no CapacityLens records/i)
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
