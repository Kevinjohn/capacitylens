import { describe, it, expect } from 'vitest'
import { parseData, serializeData } from './transfer'
import { seed } from './seed'

describe('data transfer', () => {
  it('round-trips through serialize -> parse (deep equal)', () => {
    const data = seed()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('rejects JSON that is not Floaty-shaped (so import never silently wipes data)', () => {
    expect(() => parseData('[1,2,3]')).toThrow()
    expect(() => parseData('{"data":5}')).toThrow()
    expect(() => parseData('5')).toThrow()
    expect(() => parseData('{"foo":"bar"}')).toThrow()
    expect(() => parseData('"hello"')).toThrow()
    expect(() => parseData('{"resources":"oops"}')).toThrow()
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
