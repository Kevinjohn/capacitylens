import { describe, expect, it } from 'vitest';
import { MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays';
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { formatShortDate } from '@/lib/dateDisplay';
import { makeAllocation } from '@/test/fixtures';
import { resolveEndDate, validateAllocationDraft } from './allocationDraft';
import type {
  AllocationDraftProblem,
  AllocationDraftValidationInput,
  EndDateInput,
} from './allocationDraft';

type DraftRepeat = NonNullable<AllocationDraftValidationInput['repeat']>;

// A Monday-to-Tuesday hourly allocation with a typed Start/End pair and no repeat. Every guard
// test changes only the fields it needs from this valid baseline, so a reported problem points at
// that guard.
function validInput(
  overrides: Partial<AllocationDraftValidationInput> = {},
): AllocationDraftValidationInput {
  return {
    resourceId: 'r1',
    activityId: 't1',
    startDate: '2027-01-04',
    endDate: '2027-01-05',
    usesTypedDateRange: true,
    typedDateSpanTooLong: false,
    isBlocks: false,
    isDays: false,
    isExternal: false,
    validDaysOver: true,
    spanFitsDateDomain: true,
    spanLimitedByDateDomain: false,
    maximumDaysOver: 30,
    daysOfWork: 2,
    hoursPerDay: 4,
    effHoursPerDay: 4,
    repeat: null,
    ...overrides,
  };
}

// A weekly repeat whose cutoff yields four occurrences from the baseline start.
function validRepeat(overrides: Partial<DraftRepeat> = {}): DraftRepeat {
  return {
    selection: 'weekly',
    until: '2027-01-25',
    today: '2027-01-01',
    maximum: '2027-12-31',
    ...overrides,
  };
}

function validateDraft(overrides: Partial<AllocationDraftValidationInput>) {
  const problems: AllocationDraftProblem[] = [];
  const valid = validateAllocationDraft(validInput(overrides), (field, message) => {
    problems.push({ field, message });
  });
  return { valid, problems };
}

function expectRejected(
  overrides: Partial<AllocationDraftValidationInput>,
  field: AllocationDraftProblem['field'],
  message: string,
) {
  expect(validateDraft(overrides)).toEqual({ valid: false, problems: [{ field, message }] });
}

function expectAccepted(overrides: Partial<AllocationDraftValidationInput>) {
  expect(validateDraft(overrides)).toEqual({ valid: true, problems: [] });
}

const spanMode = { usesTypedDateRange: false, isBlocks: true } as const;
const daysMode = { usesTypedDateRange: false, isDays: true } as const;

describe('validateAllocationDraft', () => {
  it('accepts the valid baseline in every mode', () => {
    expectAccepted({});
    expectAccepted(spanMode);
    expectAccepted(daysMode);
    expectAccepted({ isExternal: true, hoursPerDay: 0, effHoursPerDay: 0 });
    expectAccepted({ repeat: validRepeat() });
  });

  it('requires a resource and then an activity before anything else', () => {
    expectRejected({ resourceId: '' }, 'resource', m.form_allocation_err_choose_resource());
    expectRejected({ activityId: '' }, 'activity', m.form_allocation_err_choose_activity());
    // Selections run first, so a broken date range behind them stays unreported.
    expectRejected(
      { resourceId: '', startDate: '' },
      'resource',
      m.form_allocation_err_choose_resource(),
    );
  });

  it('requires both typed dates', () => {
    expectRejected({ startDate: '' }, 'dates', m.form_allocation_err_dates_required());
    expectRejected({ endDate: '' }, 'dates', m.form_allocation_err_dates_required());
  });

  it('rejects a typed end before the start and accepts a one-day range', () => {
    expectRejected({ endDate: '2027-01-03' }, 'dates', m.form_allocation_err_end_before_start());
    expectAccepted({ endDate: '2027-01-04' });
  });

  it('rejects a typed span longer than the product cap', () => {
    expectRejected(
      { typedDateSpanTooLong: true },
      'dates',
      m.form_allocation_err_date_span_range({ max: MAX_SPAN_DAYS.toLocaleString('en-GB') }),
    );
  });

  it('skips every typed-range rule when the mode derives the end from a span', () => {
    expectAccepted({ ...spanMode, endDate: '2027-01-01', typedDateSpanTooLong: true });
    expectAccepted({ ...spanMode, endDate: '' });
  });

  it('requires a start date in span modes', () => {
    expectRejected({ ...spanMode, startDate: '' }, 'dates', m.form_allocation_err_start_required());
    expectRejected({ ...daysMode, startDate: '' }, 'dates', m.form_allocation_err_start_required());
  });

  it('rejects an out-of-range span with the product cap', () => {
    expectRejected(
      { ...spanMode, validDaysOver: false },
      'daysOver',
      m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }),
    );
  });

  it('names the date-domain limit or the span maximum when the span does not fit', () => {
    expectRejected(
      { ...spanMode, spanFitsDateDomain: false, spanLimitedByDateDomain: true },
      'daysOver',
      m.form_allocation_err_days_over_date_domain(),
    );
    expectRejected(
      { ...daysMode, spanFitsDateDomain: false, maximumDaysOver: 12 },
      'daysOver',
      m.form_allocation_err_days_over_range({ max: 12 }),
    );
  });

  it('requires positive days of work in days mode only', () => {
    const daysError = m.form_allocation_err_days_of_work_gt_zero();
    expectRejected({ ...daysMode, daysOfWork: 0 }, 'daysOfWork', daysError);
    expectRejected({ ...daysMode, daysOfWork: Number.NaN }, 'daysOfWork', daysError);
    expectAccepted({ ...spanMode, daysOfWork: 0 });
  });

  it('requires positive hours for an hourly allocation but not an external one', () => {
    const hoursError = m.form_allocation_err_hours_gt_zero();
    expectRejected({ hoursPerDay: 0 }, 'hours', hoursError);
    expectRejected({ hoursPerDay: Number.NaN }, 'hours', hoursError);
    expectAccepted({ hoursPerDay: 0.5, effHoursPerDay: 0.5 });
    expectAccepted({ isExternal: true, hoursPerDay: 0 });
  });

  it('requires a valid repeat cutoff', () => {
    const required = m.form_allocation_err_repeat_until_required();
    expectRejected({ repeat: validRepeat({ until: '' }) }, 'repeatUntil', required);
    expectRejected({ repeat: validRepeat({ until: '2027-02-30' }) }, 'repeatUntil', required);
  });

  it('rejects a cutoff before today and accepts one equal to today', () => {
    expectRejected(
      { repeat: validRepeat({ today: '2027-01-26' }) },
      'repeatUntil',
      m.form_allocation_err_repeat_until_past(),
    );
    expectAccepted({ repeat: validRepeat({ today: '2027-01-25' }) });
  });

  it('rejects a cutoff before the start and treats one equal to it as having no repeat', () => {
    expectRejected(
      { repeat: validRepeat({ until: '2027-01-03' }) },
      'repeatUntil',
      m.form_allocation_err_repeat_until_before_start(),
    );
    expectRejected(
      { repeat: validRepeat({ until: '2027-01-04' }) },
      'repeatUntil',
      m.form_allocation_err_repeat_until_no_occurrence(),
    );
  });

  it('rejects a repeat with no maximum cutoff', () => {
    expectRejected(
      { repeat: validRepeat({ maximum: undefined }) },
      'repeatUntil',
      m.form_allocation_err_repeat_date_domain(),
    );
  });

  it('rejects a cutoff after the maximum and accepts one equal to it', () => {
    expectRejected(
      { repeat: validRepeat({ maximum: '2027-01-24' }) },
      'repeatUntil',
      m.form_allocation_err_repeat_until_after_max({ max: formatShortDate('2027-01-24') }),
    );
    expectAccepted({ repeat: validRepeat({ maximum: '2027-01-25' }) });
  });

  it('reports other repeat generation codes as the date-domain message', () => {
    // The supplied maximum is beyond the policy horizon, so generation throws cutoff-after-limit.
    expectRejected(
      { repeat: validRepeat({ until: '2099-01-04', maximum: '2099-12-31' }) },
      'repeatUntil',
      m.form_allocation_err_repeat_date_domain(),
    );
  });

  it('accepts effective hours up to the daily maximum and rejects anything above it', () => {
    expectAccepted({ hoursPerDay: MAX_HOURS_PER_DAY, effHoursPerDay: MAX_HOURS_PER_DAY });
    const hoursError = m.form_allocation_err_hours_over_max({ max: MAX_HOURS_PER_DAY });
    expectRejected({ effHoursPerDay: MAX_HOURS_PER_DAY + 0.5 }, 'hours', hoursError);
    expectRejected({ effHoursPerDay: Number.NaN }, 'hours', hoursError);
    expectRejected({ effHoursPerDay: Number.POSITIVE_INFINITY }, 'hours', hoursError);
    expectRejected({ effHoursPerDay: 0 }, 'hours', hoursError);
  });

  it('reports over-limit effective hours on days of work in days mode', () => {
    expectAccepted({ ...daysMode, effHoursPerDay: MAX_HOURS_PER_DAY });
    expectRejected(
      { ...daysMode, effHoursPerDay: MAX_HOURS_PER_DAY + 0.5 },
      'daysOfWork',
      m.form_allocation_err_days_over_max({ max: MAX_HOURS_PER_DAY }),
    );
  });

  it('skips the effective-hours rule for blocks and external allocations', () => {
    expectAccepted({ ...spanMode, effHoursPerDay: Number.NaN });
    expectAccepted({ isExternal: true, hoursPerDay: 0, effHoursPerDay: Number.NaN });
  });
});

function endDateInput(overrides: Partial<EndDateInput> = {}): EndDateInput {
  return {
    editing: makeAllocation({
      resourceId: 'r1',
      startDate: '2027-01-04',
      endDate: '2027-01-08',
      ignoreWeekends: null,
    }),
    isBlocks: true,
    isDays: false,
    resourceId: 'r1',
    startDate: '2027-01-04',
    ignoreWeekends: false,
    daysOver: 5,
    initialDaysOver: 5,
    effectiveEndDate: '2027-01-11',
    ...overrides,
  };
}

describe('resolveEndDate', () => {
  it('keeps the stored end for an unchanged span-mode edit, reading a null flag as false', () => {
    expect(resolveEndDate(endDateInput())).toBe('2027-01-08');
    expect(resolveEndDate(endDateInput({ isBlocks: false, isDays: true }))).toBe('2027-01-08');
  });

  it('derives the end for a creation or an hourly edit', () => {
    expect(resolveEndDate(endDateInput({ editing: undefined }))).toBe('2027-01-11');
    expect(resolveEndDate(endDateInput({ isBlocks: false }))).toBe('2027-01-11');
  });

  it('derives the end when anything the span depends on changed', () => {
    expect(resolveEndDate(endDateInput({ resourceId: 'r2' }))).toBe('2027-01-11');
    expect(resolveEndDate(endDateInput({ startDate: '2027-01-05' }))).toBe('2027-01-11');
    expect(resolveEndDate(endDateInput({ ignoreWeekends: true }))).toBe('2027-01-11');
    expect(resolveEndDate(endDateInput({ daysOver: 6 }))).toBe('2027-01-11');
  });

  it('compares against a stored ignoreWeekends flag when one is present', () => {
    const editing = makeAllocation({
      resourceId: 'r1',
      startDate: '2027-01-04',
      endDate: '2027-01-08',
      ignoreWeekends: true,
    });
    expect(resolveEndDate(endDateInput({ editing, ignoreWeekends: true }))).toBe('2027-01-08');
    expect(resolveEndDate(endDateInput({ editing }))).toBe('2027-01-11');
  });
});
