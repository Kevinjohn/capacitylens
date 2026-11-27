import { test } from '@japa/runner'
import { buildDayCapacity } from '@capacitylens/shared/lib/capacity'
import { resolveEffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek'
import type { Allocation, Resource } from '@capacitylens/shared/types/entities'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'

const resource: Resource = {
  ...NULLABLE_FIELDS.resources,
  id: 'r-diana',
  companyId: 'a-themyscira',
  createdAt: 't',
  updatedAt: 't',
  kind: 'person',
  name: 'Diana Prince',
  jobTitle: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#111111',
}

const allocation: Allocation = {
  ...NULLABLE_FIELDS.allocations,
  id: 'al-1',
  companyId: 'a-themyscira',
  createdAt: 't',
  updatedAt: 't',
  resourceId: 'r-diana',
  activityId: 'act-1',
  startDate: '2026-06-01',
  endDate: '2026-06-01',
  hoursPerDay: 9,
  status: 'confirmed',
}

test.group('shared capacity under Node', () => {
  // Node has no `import.meta.env`; the development-only finite-hours check must not read through it.
  test('computes a resource-day outside the Vite environment', ({ assert }) => {
    assert.deepEqual(
      buildDayCapacity({
        resource,
        date: '2026-06-01',
        allocations: [allocation],
        timeOff: [],
        effectiveWeek: resolveEffectiveWorkingWeek(resource, [1, 2, 3, 4, 5]),
        closures: [],
      }),
      { date: '2026-06-01', allocated: 9, available: 8, over: true }
    )
  })
})
