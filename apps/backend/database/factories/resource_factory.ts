import factory from '@adonisjs/lucid/factories'
import Resource from '#models/resource'
import { DateTime } from 'luxon'
import type { Weekday } from '@capacitylens/shared/types/entities'

/** Resources rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const ResourceFactory = factory
  .define(Resource, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    color: '#f97316',
    jobTitle: faker.person.jobTitle(),
    kind: 'person' as const,
    employmentType: 'permanent' as const,
    engagement: 'studio' as const,
    workingDays: [1, 2, 3, 4, 5] as Weekday[],
    halfDays: [] as Weekday[],
    workingHoursPerDay: 8,
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build()
