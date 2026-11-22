import type { Group } from '@japa/runner/core';
import testUtils from '@adonisjs/core/services/test_utils';
import { freshDatabase } from '#tests/helpers/fresh_database';

/**
 * Migrate once for the group, then run each test inside a global transaction that is rolled back
 * afterwards. Only for groups that send no HTTP request and never reach Account Kit: the Kit refuses
 * a connection already in a transaction, and the rate limiter's database store waits for the one
 * pooled connection the transaction holds.
 */
export function transactionalDatabase(group: Group) {
  group.setup(() => freshDatabase());
  group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
}
