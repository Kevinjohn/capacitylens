import { test } from '@japa/runner';
import { freshDatabase } from '../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { advancePlanningRevision, getPlanningRevision } from '#services/planning_revision';
import { replaceWithSeed } from '#tests/helpers/state_fixture';

test.group('company planning revision storage', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => replaceWithSeed());

  test('defaults old companies to zero and advances once per company transaction', async ({
    assert,
  }) => {
    assert.equal(await db.transaction((trx) => getPlanningRevision(trx, 'a-studio')), 0);

    const results = await db.transaction(async (trx) => {
      const first = await advancePlanningRevision(trx, 'a-studio');
      const repeated = await advancePlanningRevision(trx, 'a-studio');
      const otherCompany = await advancePlanningRevision(trx, 'a-loft');
      assert.equal(await getPlanningRevision(trx, 'a-studio'), 1);
      return [first, repeated, otherCompany];
    });
    assert.deepEqual(results, [1, 1, 1]);
    assert.equal(await db.transaction((trx) => getPlanningRevision(trx, 'a-studio')), 1);
    assert.equal(await db.transaction((trx) => advancePlanningRevision(trx, 'a-studio')), 2);
  });

  test('rolls back a revision advance with the caller transaction', async ({ assert }) => {
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await advancePlanningRevision(trx, 'a-studio');
          throw new Error('rollback');
        }),
      /rollback/
    );
    assert.equal(await db.transaction((trx) => getPlanningRevision(trx, 'a-studio')), 0);
    assert.isNull(
      await db.from('company_planning_revisions').where('company_id', 'a-studio').first()
    );
  });
});
