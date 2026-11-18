import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import {
  resolveAllocatedHoursOnDay as allocatedHoursOnDayWithWeek,
  resolveAvailableHoursOnDay as availableHoursOnDayWithWeek,
  buildCapacityAdvisory as capacityAdvisoryWithWeek,
  buildCapacityWindow as capacityForWindowWithWeek,
  buildDayCapacity as dayCapacityWithWeek,
  isWorkingDay as isWorkingDayWithWeek,
  resolveScheduledHoursOnDay as scheduledHoursOnDayWithWeek,
  resolveUtilization as utilizationWithWeek,
} from '../capacity.js';
import type { DayCapacity, CapacityAllocationInput } from '../capacity.js';
import { effectiveWorkingWeek } from '../effectiveWorkingWeek.js';
import type {
  Allocation,
  Closure,
  ISODate,
  Resource,
  TimeOff,
  Weekday,
} from '../../types/entities.js';

export function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Expected value at index ${index}`);
  return value;
}

export interface AvailableHoursOnDayTestInput {
  resource: Resource;
  date: ISODate;
  timeOff: TimeOff[];
  accountWorkingDays?: Weekday[] | undefined;
}

export interface AllocatedHoursOnDayTestInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  accountWorkingDays?: Weekday[] | undefined;
}

export interface DayCapacityTestInput {
  resource: Resource;
  date: ISODate;
  allocations: Allocation[];
  timeOff: TimeOff[];
  accountWorkingDays?: Weekday[] | undefined;
}

export interface CapacityForWindowTestInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: TimeOff[];
  start: ISODate;
  end: ISODate;
  accountWorkingDays?: Weekday[] | undefined;
}

export interface UtilizationTestInput {
  resource: Resource;
  allocations: Allocation[];
  timeOff: TimeOff[];
  start: ISODate;
  end: ISODate;
  accountWorkingDays?: Weekday[] | undefined;
  closures?: Closure[] | undefined;
}

export interface CapacityAdvisoryTestInput {
  resource: Resource;
  proposal: CapacityAllocationInput;
  otherAllocations: readonly CapacityAllocationInput[];
  timeOff: TimeOff[];
  accountWorkingDays?: Weekday[] | undefined;
  closures?: Closure[] | undefined;
}

export interface CapacityCaseInput {
  name: string;
  date: ISODate;
  allocations: readonly Allocation[];
  timeOff: readonly TimeOff[];
  expected: Pick<DayCapacity, 'allocated' | 'available' | 'over'>;
}

export interface ProposalTestInput {
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  ignoreWorkingDays: boolean;
}

export const DEFAULT_ACCOUNT_WORKING_DAYS: Weekday[] = [1, 2, 3, 4, 5];
export const weekFor = (resource: Resource, accountWorkingDays = DEFAULT_ACCOUNT_WORKING_DAYS) =>
  effectiveWorkingWeek(resource, accountWorkingDays);
export const scheduledHoursOnDay = (
  resource: Resource,
  date: ISODate,
  accountWorkingDays?: Weekday[],
) => scheduledHoursOnDayWithWeek(resource, date, weekFor(resource, accountWorkingDays));

export const availableHoursOnDay = ({
  resource,
  date,
  timeOff,
  accountWorkingDays,
}: AvailableHoursOnDayTestInput) =>
  availableHoursOnDayWithWeek({
    resource: resource,
    date: date,
    timeOff: timeOff,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: [],
  });
export const allocatedHoursOnDay = ({
  resource,
  date,
  allocations,
  accountWorkingDays,
}: AllocatedHoursOnDayTestInput) =>
  allocatedHoursOnDayWithWeek({
    resource: resource,
    date: date,
    allocations: allocations,
    effectiveWeek: weekFor(resource, accountWorkingDays),
  });
export const dayCapacity = ({
  resource,
  date,
  allocations,
  timeOff,
  accountWorkingDays,
}: DayCapacityTestInput) =>
  dayCapacityWithWeek({
    resource: resource,
    date: date,
    allocations: allocations,
    timeOff: timeOff,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: [],
  });
export const capacityForWindow = ({
  resource,
  allocations,
  timeOff,
  start,
  end,
  accountWorkingDays,
}: CapacityForWindowTestInput) =>
  capacityForWindowWithWeek({
    resource: resource,
    allocations: allocations,
    timeOff: timeOff,
    start: start,
    end: end,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: [],
  });
export const utilization = ({
  resource,
  allocations,
  timeOff,
  start,
  end,
  accountWorkingDays,
  closures = [],
}: UtilizationTestInput) =>
  utilizationWithWeek({
    resource: resource,
    allocations: allocations,
    timeOff: timeOff,
    start: start,
    end: end,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: closures,
  });
export const capacityAdvisory = ({
  resource,
  proposal,
  otherAllocations,
  timeOff,
  accountWorkingDays,
  closures = [],
}: CapacityAdvisoryTestInput) =>
  capacityAdvisoryWithWeek({
    resource: resource,
    proposal: proposal,
    otherAllocations: otherAllocations,
    timeOff: timeOff,
    effectiveWeek: weekFor(resource, accountWorkingDays),
    closures: closures,
  });
export const isWorkingDay = (resource: Resource, date: ISODate, accountWorkingDays?: Weekday[]) =>
  isWorkingDayWithWeek(weekFor(resource, accountWorkingDays), date);

export const makeResource = (
  over: Partial<Resource> = { ...NULLABLE_FIELDS.resources },
): Resource => ({
  ...NULLABLE_FIELDS.resources,
  id: 'r1',
  companyId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  kind: 'person',
  role: 'Developer',
  employmentType: 'permanent',
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#000',
  ...over,
  halfDays: over.halfDays ?? [],
});

export const makeAlloc = (
  over: Partial<Allocation> = { ...NULLABLE_FIELDS.allocations },
): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  id: 'a1',
  companyId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  resourceId: 'r1',
  activityId: 'activity1',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  hoursPerDay: 4,
  status: 'confirmed',
  ...over,
});

export const makeTimeOff = (over: Partial<TimeOff> = { ...NULLABLE_FIELDS.timeOff }): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  id: 'to1',
  companyId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  resourceId: 'r1',
  startDate: '2026-06-03',
  endDate: '2026-06-03',
  type: 'holiday',
  ...over,
});

export const makeClosure = (over: Partial<Closure> = {}): Closure => ({
  id: 'closure1',
  companyId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  name: 'Company shutdown',
  startDate: '2026-06-03',
  endDate: '2026-06-03',
  ...over,
});

export function makeProposal(resource: Resource) {
  return ({
    startDate,
    endDate,
    hoursPerDay,
    ignoreWorkingDays,
  }: ProposalTestInput): CapacityAllocationInput => ({
    resourceId: resource.id,
    startDate,
    endDate,
    hoursPerDay,
    ignoreWorkingDays,
  });
}
