import { describe, it, expect } from 'vitest';
import { isValidISODate, parseISOTimestamp } from './isoDates.js';

describe('isValidISODate', () => {
  it('accepts real dates skipped by local time zones and rejects malformed or impossible ones', () => {
    expect(isValidISODate('2026-06-01')).toBe(true);
    expect(isValidISODate('nope')).toBe(false);
    expect(isValidISODate('x2026-06-01')).toBe(false);
    expect(isValidISODate('2026-06-01x')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('0000-01-01')).toBe(false);
    expect(isValidISODate('2011-12-30')).toBe(true);
    expect(isValidISODate('1994-12-31')).toBe(true);
  });

  it('rejects a NON-STRING even when it stringifies to a valid-looking date', () => {
    // Non-string values must fail before regex matching so coercible arrays cannot masquerade as valid dates.
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(20260601)).toBe(false);
    expect(isValidISODate(['2026-06-01'])).toBe(false);
  });
});

describe('parseISOTimestamp', () => {
  it('accepts canonical UTC, supported fractional precision, and explicit offsets', () => {
    expect(parseISOTimestamp('2026-01-01T00:00:00.000Z')).toBe(Date.UTC(2026, 0, 1));
    expect(parseISOTimestamp('2026-01-01T00:00:00.1Z')).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 100));
    expect(parseISOTimestamp('2026-01-01T01:00:00+01:00')).toBe(Date.UTC(2026, 0, 1));
    expect(parseISOTimestamp('2024-02-29T12:00:00Z')).toBe(Date.UTC(2024, 1, 29, 12));
  });

  it.each([
    '0',
    '01/01/2000',
    '2026-01-01T00:00:00',
    '2026-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00+24:00',
    '2026-01-01T00:00:00.1234Z',
  ])('rejects malformed, rolled, or unsupported timestamp %s', (value) => {
    expect(parseISOTimestamp(value)).toBeNull();
  });
});
