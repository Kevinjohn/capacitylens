import { describe, it, expect } from 'vitest';
import { addDaysISO } from './dateMath.js';
import { MAX_SPAN_DAYS } from './schedulingDays.js';
import {
  allocationAttributionAllowed,
  effectiveProjectId,
  validateAllocationAssignment,
  validateDateRange,
  validateProjectClient,
  withoutAllocationAttribution,
} from './integrity.js';
import { placeholder, unboundPlaceholder, person } from './integrity.test.support.js';

describe('allocationAttributionAllowed', () => {
  it('allows allocation-level project attribution only for repeatable activities', () => {
    expect(allocationAttributionAllowed('repeatable')).toBe(true);
    expect(allocationAttributionAllowed('project')).toBe(false);
    expect(allocationAttributionAllowed('internal')).toBe(false);
    expect(allocationAttributionAllowed('unknown')).toBe(false);
  });
});

describe('withoutAllocationAttribution', () => {
  it('returns a restamped copy without projectId', () => {
    const original = { id: 'al1', projectId: 'p1', updatedAt: 'before' };
    expect(withoutAllocationAttribution(original, 'after')).toEqual({
      id: 'al1',
      projectId: null,
      updatedAt: 'after',
    });
    expect(original).toHaveProperty('projectId', 'p1');
    expect(original).toHaveProperty('updatedAt', 'before');
  });

  it('preserves extra fields and the existing timestamp when no restamp is supplied', () => {
    const original = { id: 'al1', projectId: 'p1', updatedAt: 'before', note: 'Keep me' };
    const cleared = withoutAllocationAttribution(original);
    expect(cleared).toEqual({ id: 'al1', projectId: null, updatedAt: 'before', note: 'Keep me' });
    expect(cleared).not.toBe(original);
  });
});

describe('effectiveProjectId', () => {
  it('uses allocation attribution when present, otherwise activity attribution', () => {
    expect(effectiveProjectId({ projectId: 'allocation' }, { projectId: 'activity' })).toBe(
      'allocation',
    );
    expect(effectiveProjectId({ projectId: null }, { projectId: 'activity' })).toBe('activity');
    expect(effectiveProjectId({ projectId: null }, { projectId: null })).toBeUndefined();
  });
});

describe('validateProjectClient', () => {
  it('requires a client', () => {
    expect(validateProjectClient('c1').ok).toBe(true);
    expect(validateProjectClient('').ok).toBe(false);
    expect(validateProjectClient(undefined).ok).toBe(false);
  });
});

describe('validateDateRange', () => {
  it('accepts a normal range and a single day', () => {
    expect(validateDateRange('2026-06-01', '2026-06-05').ok).toBe(true);
    expect(validateDateRange('2026-06-01', '2026-06-01').ok).toBe(true);
  });
  it('rejects a missing end or start', () => {
    expect(validateDateRange('2026-06-01', '').ok).toBe(false);
    expect(validateDateRange('', '2026-06-01').ok).toBe(false);
    expect(validateDateRange(undefined, undefined).ok).toBe(false);
  });
  it('rejects a reversed range', () => {
    const v = validateDateRange('2026-06-05', '2026-06-01');
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/before the start/i);
  });
  it('accepts the maximum calendar span and rejects one day more', () => {
    const start = '2026-01-01';
    expect(validateDateRange(start, addDaysISO(start, MAX_SPAN_DAYS - 1)).ok).toBe(true);
    expect(validateDateRange(start, addDaysISO(start, MAX_SPAN_DAYS))).toEqual({
      ok: false,
      errors: ['Date span cannot exceed 36,500 calendar days.'],
      codes: ['date_span_too_long'],
    });
  });
  it('rejects non-zero-padded and out-of-range dates (the invariant isWithin relies on)', () => {
    // A non-padded "2026-6-1" would break isWithin's lexicographic compare, so it must
    // never pass this write-boundary guard.
    expect(validateDateRange('2026-6-1', '2026-06-05').ok).toBe(false);
    expect(validateDateRange('2026-06-01', '2026-6-5').ok).toBe(false);
    expect(validateDateRange('2026-13-01', '2026-12-01').ok).toBe(false);
    expect(validateDateRange('2026-02-30', '2026-03-05').ok).toBe(false);
    expect(validateDateRange('2026-13-01', '2026-12-01').errors[0]).toMatch(
      /valid calendar dates/i,
    );
  });
});

describe('placeholder binding', () => {
  it('a person can be assigned any project activity', () => {
    expect(validateAllocationAssignment(person(), 'anything').ok).toBe(true);
  });

  it('a placeholder can only be assigned activities from its bound project', () => {
    const ph = placeholder({ projectId: 'p1' });
    expect(validateAllocationAssignment(ph, 'p1').ok).toBe(true);
    expect(validateAllocationAssignment(ph, 'p2').ok).toBe(false);
  });

  it('validateAllocationAssignment explains the rejection', () => {
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), 'p2').ok).toBe(false);
    expect(validateAllocationAssignment(unboundPlaceholder(), 'p1').ok).toBe(false);
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), 'p1').ok).toBe(true);
    expect(validateAllocationAssignment(person(), 'p1').ok).toBe(true);
  });

  it('distinguishes an UNBOUND placeholder from a wrong-project one by message', () => {
    // An unbound placeholder (no projectId) and one bound to the wrong project both reject,
    // but with different reasons, so the `!resource.projectId` branch and each message string
    // are load-bearing, not interchangeable.
    expect(validateAllocationAssignment(unboundPlaceholder(), 'p1').errors[0]).toMatch(
      /not bound to a project/i,
    );
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), 'p2').errors[0]).toMatch(
      /only be assigned to activities from its bound project/i,
    );
  });

  it('a general (no-project) activity can be assigned to anyone — people and placeholders', () => {
    expect(validateAllocationAssignment(person(), undefined).ok).toBe(true);
    // The project restriction does not bite when the activity has no project.
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), undefined).ok).toBe(true);
    expect(validateAllocationAssignment(unboundPlaceholder(), undefined).ok).toBe(true);
  });
});
