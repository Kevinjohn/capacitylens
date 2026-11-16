import { describe, expect, it, vi } from 'vitest';
import { toISODate } from '@capacitylens/shared/lib/dateMath';

async function isolatedCalendarToday() {
  vi.resetModules();
  return await import('./calendarToday');
}

describe('readCalendarToday invalid zones', () => {
  it('warns (not silently) and still returns the local date for a malformed IANA zone', async () => {
    const { readCalendarToday } = await isolatedCalendarToday();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readCalendarToday('Not/AZone')).toBe(toISODate(new Date()));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('readCalendarToday: invalid timeZone "Not/AZone"'),
      expect.any(RangeError),
    );
    readCalendarToday('Not/AZone');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('emits one aggregate warning when invalid-zone deduplication reaches its bound', async () => {
    const { readCalendarToday } = await isolatedCalendarToday();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let index = 0; index < 33; index += 1) {
      expect(readCalendarToday(`Invalid/Zone-${index}`)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(warnSpy).toHaveBeenCalledTimes(33);
    expect(warnSpy.mock.calls.at(-1)?.[0]).toMatch(
      /32 distinct invalid time zones.*further distinct values/i,
    );
    readCalendarToday('Invalid/Zone-34');
    expect(warnSpy).toHaveBeenCalledTimes(33);
    warnSpy.mockRestore();
  });

  it('does not warn for a valid or absent zone', async () => {
    const { readCalendarToday } = await isolatedCalendarToday();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readCalendarToday('UTC', Date.parse('2026-06-14T20:00:00Z'))).toBe('2026-06-14');
    readCalendarToday();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
