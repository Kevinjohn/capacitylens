import factory from '@adonisjs/lucid/factories';
import Client from '#models/client';
import { DateTime } from 'luxon';

/** Clients rows are company-scoped: merge `companyId` and the parent ids the test needs. */
export const ClientFactory = factory
  .define(Client, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.company.name(),
    color: '#0ea5e9',
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build();
