import factory from '@adonisjs/lucid/factories'
import Project from '#models/project'
import { DateTime } from 'luxon'

/** Projects rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const ProjectFactory = factory
  .define(Project, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.commerce.productName(),
    color: '#22c55e',
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build()
