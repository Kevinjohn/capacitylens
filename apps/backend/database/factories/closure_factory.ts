import factory from '@adonisjs/lucid/factories';
import Closure from '#models/closure';
import { DateTime } from 'luxon';

/** Closures rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const ClosureFactory = factory
  .define(Closure, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.word.words(2),
    startDate: '2026-01-05',
    endDate: '2026-01-05',
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build();
