import {
  FIXTURE_ALLOCATION,
  FIXTURE_COMPANY,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_RESOURCE_PERSON,
} from '@capacitylens/shared/data/fixtures';
import {
  createEmptyAppData,
  type Allocation,
  type AppData,
  type Resource,
  type SchedulingMode,
} from '@capacitylens/shared/types/entities';
import {
  buildAllocationOccurrences,
  type RepeatRange,
} from '#services/planning/repeat_occurrences';
import type { PlanningIntent } from '#validators/planning/contracts';

/** The fixture company's id. */
export const fixtureCompanyId = FIXTURE_COMPANY.id;

/** A Monday to Wednesday allocation span for the fixture person. */
export const firstSpan = {
  resourceId: FIXTURE_RESOURCE_PERSON.id,
  startDate: '2026-06-01',
  endDate: '2026-06-03',
};

function repeatCompanyData(schedulingMode: SchedulingMode): AppData {
  return {
    ...createEmptyAppData(),
    companies: [
      { ...FIXTURE_COMPANY, schedulingMode, weekStartsOn: 1, workingDays: [1, 2, 3, 4, 5] },
    ],
    resources: [{ ...FIXTURE_RESOURCE_PERSON, workingDays: [1, 2, 3] }],
  };
}

/** The [start, end] spans an allocation repeat produces for a Monday to Wednesday person. */
export const allocationOccurrences = (
  schedulingMode: SchedulingMode,
  repeat: RepeatRange,
  from = firstSpan
) =>
  buildAllocationOccurrences(repeatCompanyData(schedulingMode), fixtureCompanyId, from, repeat).map(
    ({ startDate, endDate }) => [startDate, endDate]
  );

const person: Resource = {
  ...FIXTURE_RESOURCE_PERSON,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  firstAvailableDate: null,
  lastAvailableDate: null,
  archivedAt: null,
};

// Two eight-hour bookings on Monday 1 June 2026 for a person with eight available hours.
const booking = (id: string, resourceId: string = person.id): Allocation => ({
  ...FIXTURE_ALLOCATION,
  id,
  resourceId,
  seriesId: null,
  startDate: '2026-06-01',
  endDate: '2026-06-01',
  hoursPerDay: 8,
  status: 'confirmed',
  ignoreWorkingDays: false,
});

/** A company whose resource has two eight-hour bookings on Monday 1 June 2026. */
export function advisoryCompanyData(
  schedulingMode: SchedulingMode,
  resourceId: string = person.id
): AppData {
  return {
    ...createEmptyAppData(),
    companies: [
      { ...FIXTURE_COMPANY, schedulingMode, weekStartsOn: 1, workingDays: [1, 2, 3, 4, 5] },
    ],
    resources: [person, FIXTURE_RESOURCE_EXTERNAL],
    allocations: [booking('existing', resourceId), booking('saved', resourceId)],
  };
}

/** The create intent of the booking `saved`. */
export const createSaved = {
  operation: 'allocation.create',
  allocation: { id: 'saved' },
} as PlanningIntent;
