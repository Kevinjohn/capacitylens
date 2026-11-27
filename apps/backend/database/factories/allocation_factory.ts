import factory from '@adonisjs/lucid/factories'
import Allocation from '#models/allocation'
import { DateTime } from 'luxon'

/** Allocations rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const AllocationFactory = factory
  .define(Allocation, ({ faker }) => ({
    id: faker.string.uuid(),
    startDate: '2026-01-05',
    endDate: '2026-01-09',
    hoursPerDay: 8,
    status: 'confirmed' as const,
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build()
