import factory from '@adonisjs/lucid/factories'
import Company from '#models/company'
import { DateTime } from 'luxon'

/** A company with the product defaults left null. */
export const CompanyFactory = factory
  .define(Company, ({ faker }) => ({
    id: faker.string.uuid(),
    name: faker.company.name(),
    color: '#4f46e5',
    createdAt: DateTime.now(),
    updatedAt: DateTime.now(),
  }))
  .build()
