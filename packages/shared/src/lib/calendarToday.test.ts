import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatISODate } from './dateMath.js';
import { resolveCalendarToday } from './calendarToday.js';

describe('resolveCalendarToday', () => {
  it('returns the local date when no timeZone given', () => {
    const result = resolveCalendarToday().date;
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a YYYY-MM-DD string for a valid time zone', () => {
    const result = resolveCalendarToday('America/New_York').date;
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the correct date for zones on both sides of midnight', () => {
    expect(() => resolveCalendarToday('Pacific/Auckland').date).not.toThrow();
    expect(() => resolveCalendarToday('America/Los_Angeles').date).not.toThrow();
    expect(() => resolveCalendarToday('Etc/GMT').date).not.toThrow();
  });

  it('falls back gracefully when given undefined', () => {
    expect(() => resolveCalendarToday(undefined).date).not.toThrow();
    expect(resolveCalendarToday(undefined).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('resolveCalendarToday with a fixed clock', () => {
  describe('with a fixed clock', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves the date in the GIVEN zone, not the local one — even when they disagree', () => {
      // The UTC instant is still June 14, while Kiritimati is already on June 15.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-14T20:00:00Z'));
      expect(resolveCalendarToday('Pacific/Kiritimati').date).toBe('2026-06-15');
    });

    it('resolves an EXPLICIT instant rather than the clock when `now` is given', () => {
      // The reactive-today boundary search probes future instants through this one resolver;
      // ignoring `now` would make every probe answer with the current date and the search
      // would never find the boundary.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-14T20:00:00Z'));
      const tomorrowUTC = Date.parse('2026-06-15T20:00:00Z');
      expect(resolveCalendarToday('UTC', Date.parse('2026-06-14T20:00:00Z')).date).toBe(
        '2026-06-14',
      );
      expect(resolveCalendarToday('UTC', tomorrowUTC).date).toBe('2026-06-15');
      expect(resolveCalendarToday(undefined, tomorrowUTC).date).toBe(
        formatISODate(new Date(tomorrowUTC)),
      );
    });

    it('always resolves the SAME zone, ignoring which timeZone happens to be passed', () => {
      // Guards the early-return short-circuit `if (!timeZone) return formatISODate(new
      // Date())`: forcing it to always fire (dropping the timeZone argument on the
      // floor) would make a valid, given zone come back as the local date instead.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-14T20:00:00Z'));
      expect(resolveCalendarToday('Pacific/Kiritimati').date).not.toBe(resolveCalendarToday().date);
    });
  });
});

describe('resolveCalendarToday with mocked out-of-range years', () => {
  describe('with a mocked Intl.DateTimeFormat', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // `resolveCalendarToday` caches one formatter per zone at module scope, so each case here
    // takes a fresh module instance, otherwise the
    // real formatter an earlier test cached for the same zone would answer instead of the mock.
    async function isolatedCalendarToday() {
      vi.resetModules();
      return await import('./calendarToday.js');
    }

    it('throws RangeError (not a silent pseudo-ISODate) when the resolved year is outside the four-digit domain', async () => {
      // Mock malformed formatter output to verify that an out-of-domain year is rejected.
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: 'year', value: '99' },
            { type: 'literal', value: '-' },
            { type: 'month', value: '06' },
            { type: 'literal', value: '-' },
            { type: 'day', value: '15' },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

      const isolated = await isolatedCalendarToday();
      expect(() => isolated.resolveCalendarToday('Pacific/Kiritimati').date).toThrow(
        /four-digit ISO year range/i,
      );
    });

    it("does NOT swallow the out-of-range-year error as an 'invalid timeZone' fallback", async () => {
      // The catch block around the Intl constructor call must not also catch (and silently
      // degrade) a RangeError raised by the post-assembly validation. That would misreport a
      // real bug as a benign invalid-zone case and return the (wrong) local date instead of
      // throwing per the module's contract.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: 'year', value: '10000' },
            { type: 'literal', value: '-' },
            { type: 'month', value: '01' },
            { type: 'literal', value: '-' },
            { type: 'day', value: '01' },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

      const isolated = await isolatedCalendarToday();
      expect(() => isolated.resolveCalendarToday('America/New_York').date).toThrow(RangeError);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});

describe('resolveCalendarToday formatter caching', () => {
  describe('with a mocked Intl.DateTimeFormat', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function isolatedCalendarToday() {
      vi.resetModules();
      return await import('./calendarToday.js');
    }
    it('still returns a valid zero-padded ISODate on the normal timezone path', async () => {
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function FakeDateTimeFormat() {
        return {
          formatToParts: () => [
            { type: 'year', value: '2026' },
            { type: 'literal', value: '-' },
            { type: 'month', value: '06' },
            { type: 'literal', value: '-' },
            { type: 'day', value: '05' },
          ],
        } as unknown as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

      const isolated = await isolatedCalendarToday();
      expect(isolated.resolveCalendarToday('America/New_York').date).toBe('2026-06-05');
    });

    it('builds one formatter per zone and reuses it across calls', async () => {
      // Constructing a formatter is the expensive part and the resolver runs per grid render, so the
      // per-zone cache is load-bearing, not incidental.
      const ctorSpy = vi
        .spyOn(Intl, 'DateTimeFormat')
        .mockImplementation(function FakeDateTimeFormat() {
          return {
            formatToParts: () => [
              { type: 'year', value: '2026' },
              { type: 'literal', value: '-' },
              { type: 'month', value: '06' },
              { type: 'literal', value: '-' },
              { type: 'day', value: '05' },
            ],
          } as unknown as Intl.DateTimeFormat;
        } as unknown as typeof Intl.DateTimeFormat);
      const isolated = await isolatedCalendarToday();

      isolated.resolveCalendarToday('America/New_York');
      isolated.resolveCalendarToday('America/New_York', Date.parse('2026-06-15T20:00:00Z'));
      isolated.resolveCalendarToday('Pacific/Kiritimati');

      const zones = ctorSpy.mock.calls.map(
        ([, options]) => (options as Intl.DateTimeFormatOptions | undefined)?.timeZone,
      );
      expect(zones).toEqual(['America/New_York', 'Pacific/Kiritimati']);
    });
  });
});

describe('resolveCalendarToday invalid zones', () => {
  it('reports a malformed IANA zone to the caller with the local date and never writes to the console', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveCalendarToday('Not/AZone');
    expect(result).toMatchObject({
      kind: 'invalid-time-zone',
      timeZone: 'Not/AZone',
      date: formatISODate(new Date()),
    });
    expect(result.kind === 'invalid-time-zone' && result.cause).toBeInstanceOf(RangeError);
    expect(resolveCalendarToday('Not/AZone')).toMatchObject({ kind: 'invalid-time-zone' });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
