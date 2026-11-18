import { describe, expect, it } from 'vitest';
import { formatUtilisationPercent } from './formatUtilisationPercent';

describe('formatUtilisationPercent', () => {
  it.each([
    [0.995, '99.5'],
    [0.9999, '99.9'],
    [1, '100'],
    [1.0001, '100.1'],
    [1.0049, '100.5'],
  ])('keeps %s on the correct side of the strict capacity boundary', (ratio, expected) => {
    expect(formatUtilisationPercent(ratio)).toBe(expected);
  });

  it('keeps compact whole percentages away from the boundary', () => {
    expect(formatUtilisationPercent(0.834)).toBe('83');
    expect(formatUtilisationPercent(1.236)).toBe('124');
  });
});
