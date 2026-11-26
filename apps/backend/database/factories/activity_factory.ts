import factory from '@adonisjs/lucid/factories';
import Activity from '#models/activity';
import { DateTime } from 'luxon';

/** Activities rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const ActivityFactory = factory
  .define(Activity, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.word.words(2),
    kind: 'project' as const,
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build();
