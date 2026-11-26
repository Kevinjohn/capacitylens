import factory from '@adonisjs/lucid/factories';
import TimeOff from '#models/time_off';
import { DateTime } from 'luxon';

/** Time off rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const TimeOffFactory = factory
  .define(TimeOff, ({ faker }) => ({
    id: faker.string.uuid(),
    startDate: '2026-01-05',
    endDate: '2026-01-05',
    type: 'holiday' as const,
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build();
