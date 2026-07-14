import { describe, it, expect, afterEach, vi } from 'vitest'
import { supportedTimeZones, timeZoneOffsetLabel, timeZoneOptionLabel } from './timezones'

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

describe('time zone option labels', () => {
  it('shows a numeric UTC offset for a zero-offset zone', () => {
    expect(timeZoneOffsetLabel('Etc/GMT', new Date('2026-07-01T12:00:00.000Z'))).toBe('UTC+00:00')
    expect(timeZoneOptionLabel('Etc/GMT', 'GMT', new Date('2026-07-01T12:00:00.000Z'))).toBe('GMT (UTC+00:00)')
  })

  it('reflects daylight-saving offsets for named zones', () => {
    const summer = new Date('2026-07-01T12:00:00.000Z')
    const winter = new Date('2026-01-01T12:00:00.000Z')
    expect(timeZoneOffsetLabel('Europe/London', summer)).toBe('UTC+01:00')
    expect(timeZoneOffsetLabel('Europe/London', winter)).toBe('UTC+00:00')
    expect(timeZoneOptionLabel('America/New_York', 'America/New_York', summer)).toBe('America/New_York (UTC-04:00)')
  })
})
