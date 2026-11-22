import { describe, expect, it } from 'vitest';
import {
  hasHourlyLoad,
  clampHoursPerDay,
  buildExternalCapacityDefaults,
  isCapacityTracked,
  isScopedEntityKey,
  buildPlaceholderCapacityDefaults,
} from './entities.js';

describe('entity helpers through the public facade', () => {
  it('distinguishes hourly loads, capacity-free resources and scoped tables', () => {
    expect(hasHourlyLoad('hourly')).toBe(true);
    expect(hasHourlyLoad('days')).toBe(true);
    expect(hasHourlyLoad('blocks')).toBe(false);
    expect(isCapacityTracked({ kind: 'person' })).toBe(true);
    expect(isCapacityTracked({ kind: 'placeholder' })).toBe(true);
    expect(isCapacityTracked({ kind: 'external' })).toBe(false);
    expect(isScopedEntityKey('resources')).toBe(true);
    expect(isScopedEntityKey('closures')).toBe(true);
    expect(isScopedEntityKey('companies')).toBe(false);
    expect(isScopedEntityKey('unknown')).toBe(false);
  });

  it.each([Number.NaN, Infinity, -Infinity])(
    'clamps non-finite allocation hours (%s) to zero',
    (hours) => {
      expect(clampHoursPerDay(hours)).toBe(0);
    },
  );

  it('returns independent weekday arrays for every capacity-default factory call', () => {
    const external = buildExternalCapacityDefaults();
    const placeholder = buildPlaceholderCapacityDefaults();
    const nextExternal = buildExternalCapacityDefaults();
    const nextPlaceholder = buildPlaceholderCapacityDefaults();

    external.workingDays.length = 0;
    external.halfDays.push(1);
    placeholder.workingDays.push(0);
    placeholder.halfDays.push(2);

    for (const defaults of [nextExternal, nextPlaceholder]) {
      expect(defaults.workingDays).toEqual([1, 2, 3, 4, 5]);
      expect(defaults.halfDays).toEqual([]);
    }
    expect(external.workingDays).toEqual([]);
    expect(external.halfDays).toEqual([1]);
  });
});
