import { describe, it, expect } from 'vitest';
import { resolveErrorMessage, resolveDomainErrorMessage } from './errorMessage';
import { DomainError } from '@capacitylens/shared/domain/errors';
import type { DomainErrorCode } from '@capacitylens/shared/domain/errors';
import { MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays';
import { PlanningCacheError } from '@/data/planning/planningErrors';

describe('errorMessage', () => {
  it('normalises an Error, a string, a React Router ErrorResponse, and unknown throws', () => {
    expect(resolveErrorMessage(new Error('x'))).toBe('x');
    expect(resolveErrorMessage('plain')).toBe('plain');
    expect(resolveErrorMessage({ statusText: 'Not Found' })).toBe('Not Found');
    expect(resolveErrorMessage(null)).toBe('An unexpected error occurred.');
    expect(resolveErrorMessage(undefined)).toBe('An unexpected error occurred.');
    expect(resolveErrorMessage(42)).toBe('An unexpected error occurred.');
  });

  it('tells the person to check a planning change whose reply was lost', () => {
    expect(
      resolveErrorMessage(new PlanningCacheError('Temporary outage', undefined, 502, true)),
    ).toMatch(/couldn’t confirm that your last schedule change was saved/);
    expect(resolveErrorMessage(new PlanningCacheError('Refused', 'E_NO_CHANGE', 422))).toBe(
      'Refused',
    );
  });

  it.each(['', '   ', new Error(''), new Error('   '), { statusText: '' }])(
    'never returns a blank message for %j',
    (error) => {
      expect(resolveErrorMessage(error)).toBe('An unexpected error occurred.');
    },
  );

  it('falls back to the generic message when statusText is present but not a string', () => {
    // Exercises the `typeof statusText === 'string'` guard specifically (as opposed to the
    // earlier `'statusText' in error` check, which alone would let a non-string through).
    expect(resolveErrorMessage({ statusText: 123 })).toBe('An unexpected error occurred.');
  });

  it('remains total for hostile proxies whose traps throw', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('prototype denied');
        },
        has: () => {
          throw new Error('membership denied');
        },
        get: () => {
          throw new Error('read denied');
        },
      },
    );

    expect(resolveErrorMessage(hostile)).toBe('An unexpected error occurred.');
  });

  it('snapshots a stateful Proxy statusText once before validating it', () => {
    let reads = 0;
    const stateful = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property !== 'statusText') return undefined;
          reads += 1;
          return reads === 1 ? 'Temporarily unavailable' : { changed: true };
        },
      },
    );

    expect(resolveErrorMessage(stateful)).toBe('Temporarily unavailable');
    expect(reads).toBe(1);
  });

  it('maps a domain code through translations instead of trusting fallback prose', () => {
    expect(
      resolveErrorMessage(new DomainError('E_RECORD_WRONG_COMPANY', 'obsolete server wording')),
    ).toBe('That record does not belong to the active company.');
  });
});

describe('domainErrorMessage', () => {
  // Assert exact translated copy for the fixed-message cases below.
  const fixedMessageCases: Array<[DomainErrorCode, string]> = [
    ['E_RECORD_WRONG_COMPANY', 'That record does not belong to the active company.'],
    ['E_REFERENCE_WRONG_COMPANY', 'That change references data outside the active company.'],
    ['E_ACTIVITY_PROJECT_REQUIRED', 'A project-specific activity must be assigned to a project.'],
    [
      'E_ACTIVITY_PROJECT_FORBIDDEN',
      'An internal or all-projects activity cannot belong to a project.',
    ],
    [
      'E_ACTIVITY_PHASE_FORBIDDEN',
      'An internal or all-projects activity cannot belong to a phase.',
    ],
    ['E_ACTIVITY_PHASE_WRONG_COMPANY', 'Activity phase must belong to this company.'],
    [
      'E_ACTIVITY_PHASE_PROJECT_REQUIRED',
      'An activity with a phase must also belong to that phase’s project.',
    ],
    ['E_ACTIVITY_PHASE_PROJECT_MISMATCH', 'Activity phase must belong to the activity’s project.'],
    ['E_RESOURCE_PROJECT_FORBIDDEN', 'Only a placeholder can be assigned to a project.'],
    [
      'E_ALLOCATION_REFERENCES_INVALID',
      'Allocation must reference an existing resource and activity in this company.',
    ],
    [
      'E_ALLOCATION_RESOURCE_INACTIVE',
      'Allocation must reference an active resource in this company.',
    ],
    [
      'E_ALLOCATION_PROJECT_INACTIVE',
      'Allocation must reference an activity under an active project in this company.',
    ],
    [
      'E_ALLOCATION_ACTIVITY_INACTIVE',
      'Allocation must reference an activity under an active project.',
    ],
    ['E_PLACEHOLDER_PROJECT_MISSING', 'This placeholder is not bound to a project yet.'],
    ['E_EXTERNAL_ALLOCATION_HOURS', 'An external party’s allocation can’t carry hours.'],
    [
      'E_RESOURCE_EXTERNAL_DEPENDENTS',
      'Reassign or remove this resource’s work and time off before making it external.',
    ],
    [
      'E_PLACEHOLDER_PROJECT_DEPENDENTS',
      'Reassign or remove this placeholder’s work before changing its bound project.',
    ],
    [
      'E_ACTIVITY_PROJECT_DEPENDENTS',
      'Reassign placeholder work before changing this activity’s project.',
    ],
    ['E_DATE_REQUIRED', 'Start and end dates are required.'],
    ['E_DATE_INVALID', 'Dates must be valid calendar dates (YYYY-MM-DD).'],
    ['E_DATE_REVERSED', 'End date cannot be before the start date.'],
    [
      'E_TIME_OFF_RESOURCE_INVALID',
      'Time off must reference an existing resource in this company.',
    ],
    ['E_TIME_OFF_RESOURCE_INACTIVE', 'Time off must reference an active resource in this company.'],
    ['E_TIME_OFF_EXTERNAL_RESOURCE', 'Time off can’t be recorded for an external party.'],
    ['E_CLOSURE_NAME_REQUIRED', 'Closure name is required.'],
  ];

  it.each(fixedMessageCases)('maps %s to its exact translated message', (code, expected) => {
    expect(resolveDomainErrorMessage(code)).toBe(expected);
  });

  it('keeps every code distinct so no two cases share a fallen-through message', () => {
    // A missing case must not silently reuse another domain code’s message.
    const messages = fixedMessageCases.map(([, expected]) => expected);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('interpolates the formatted span limit into E_DATE_SPAN_TOO_LONG', () => {
    // Pin grouped span-cap copy so interpolation and number formatting stay consistent.
    expect(resolveDomainErrorMessage('E_DATE_SPAN_TOO_LONG')).toBe(
      `Date span cannot exceed ${MAX_SPAN_DAYS.toLocaleString('en-GB')} calendar days.`,
    );
    expect(resolveDomainErrorMessage('E_DATE_SPAN_TOO_LONG')).toBe(
      'Date span cannot exceed 36,500 calendar days.',
    );
  });
});

describe('errorMessage edge cases around the plain-object statusText branch', () => {
  it('falls back to generic for a bare object with no statusText', () => {
    expect(resolveErrorMessage({})).toBe('An unexpected error occurred.');
  });

  it('falls back to generic for a whitespace-only statusText', () => {
    // Whitespace-only status text must not replace the user-facing fallback.
    expect(resolveErrorMessage({ statusText: '   ' })).toBe('An unexpected error occurred.');
  });

  it('ignores a truthy non-object error even when it carries a statusText property', () => {
    // Function properties must not be treated as error-object messages.
    const fn = (): void => undefined;
    (fn as unknown as { statusText?: string }).statusText = 'leaked from a function';
    expect(resolveErrorMessage(fn)).toBe('An unexpected error occurred.');
  });
});
