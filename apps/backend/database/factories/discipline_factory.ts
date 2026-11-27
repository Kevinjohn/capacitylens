import factory from '@adonisjs/lucid/factories'
import Discipline from '#models/discipline'
import { DateTime } from 'luxon'

/** Disciplines rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const DisciplineFactory = factory
  .define(Discipline, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.person.jobArea(),
    sortOrder: 0,
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build()
