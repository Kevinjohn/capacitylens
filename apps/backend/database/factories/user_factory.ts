import factory from '@adonisjs/lucid/factories';
import User from '#models/user';
import { DateTime } from 'luxon';

/**
 * A verified identity. `User` admits identities only inside a transaction, so create it with
 * `.client(trx)`; the model hook sets the id and timestamps.
 */
export const UserFactory = factory
  .define(User, ({ faker }) => ({
    email: faker.internet.email().toLowerCase(),
    displayName: faker.person.fullName(),
    password: null,
    unverifiedEmail: null,
    emailVerifiedAt: DateTime.now(),
  }))
  .build();
