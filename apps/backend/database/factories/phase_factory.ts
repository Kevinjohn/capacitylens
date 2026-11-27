import factory from '@adonisjs/lucid/factories'
import Phase from '#models/phase'
import { DateTime } from 'luxon'

/** Phases rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const PhaseFactory = factory
  .define(Phase, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.word.words(2),
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build()
