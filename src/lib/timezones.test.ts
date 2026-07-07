import { describe, it, expect, afterEach, vi } from 'vitest'
import { supportedTimeZones } from './timezones'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('supportedTimeZones', () => {
  it('prepends Etc/GMT when the engine list omits it', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['UTC', 'Europe/London'])
    expect(supportedTimeZones()).toEqual(['Etc/GMT', 'UTC', 'Europe/London'])
  })

  it('does not duplicate Etc/GMT when the engine list already has it', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Etc/GMT', 'UTC'])
    expect(supportedTimeZones()).toEqual(['Etc/GMT', 'UTC'])
  })

  it('falls back to the documented hand-list when the engine lacks the API', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('Intl.supportedValuesOf is not supported')
    })
    expect(supportedTimeZones()).toEqual([
      'Etc/GMT',
      'UTC',
      'Europe/London',
      'Europe/Paris',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
      'Australia/Sydney',
    ])
  })
})
