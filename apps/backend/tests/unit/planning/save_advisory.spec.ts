import { test } from '@japa/runner';
import {
  FIXTURE_COMPANY,
  FIXTURE_ALLOCATION,
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
import { buildSaveAdvisory } from '#services/planning/save_advisory';
import type { PlanningIntent } from '#validators/planning/contracts';

const companyId = FIXTURE_COMPANY.id;
const person: Resource = {
  ...FIXTURE_RESOURCE_PERSON,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  firstAvailableDate: null,
  lastAvailableDate: null,
  archivedAt: null,
  deletedAt: null,
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

function companyData(schedulingMode: SchedulingMode, resourceId: string = person.id): AppData {
  return {
    ...createEmptyAppData(),
    accounts: [
      { ...FIXTURE_COMPANY, schedulingMode, weekStartsOn: 1, workingDays: [1, 2, 3, 4, 5] },
    ],
    resources: [person, FIXTURE_RESOURCE_EXTERNAL],
    allocations: [booking('existing', resourceId), booking('saved', resourceId)],
  };
}

const create = { operation: 'allocation.create', allocation: { id: 'saved' } } as PlanningIntent;

test.group('allocation save advisory', () => {
  test('counts the saved row against the rest of its resource load', ({ assert }) => {
    assert.deepEqual(buildSaveAdvisory(create, companyData('hourly'), companyId), {
      advisory: { overDays: 1, timeOffDays: 0 },
    });
  });

  test('projects blocks-mode load instead of the stored hours', ({ assert }) => {
    assert.deepEqual(buildSaveAdvisory(create, companyData('blocks'), companyId), {
      advisory: { overDays: 0, timeOffDays: 0 },
    });
  });

  test('reports nothing for an external resource', ({ assert }) => {
    assert.deepEqual(
      buildSaveAdvisory(create, companyData('hourly', FIXTURE_RESOURCE_EXTERNAL.id), companyId),
      { advisory: { overDays: 0, timeOffDays: 0 } }
    );
  });

  test('carries no advisory for a write that is not an allocation save', ({ assert }) => {
    const deletion = { operation: 'allocation.delete', id: 'saved' } as PlanningIntent;
    assert.deepEqual(buildSaveAdvisory(deletion, companyData('hourly'), companyId), {});
  });
});
