import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { replaceWithSeed } from '#tests/helpers/state_fixture';
import { PlanningRevisionService } from '#services/planning_revision_service';

const planningRevisions = new PlanningRevisionService();

test.group('company planning revision storage', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => replaceWithSeed());

  test('defaults old companies to zero and advances once per company transaction', async ({
    assert,
  }) => {
    assert.equal(
      await db.transaction((trx) => planningRevisions.getPlanningRevision(trx, 'a-studio')),
      0
    );

    const results = await db.transaction(async (trx) => {
      const first = await planningRevisions.advancePlanningRevision(trx, 'a-studio');
      const repeated = await planningRevisions.advancePlanningRevision(trx, 'a-studio');
      const otherCompany = await planningRevisions.advancePlanningRevision(trx, 'a-loft');
      assert.equal(await planningRevisions.getPlanningRevision(trx, 'a-studio'), 1);
      return [first, repeated, otherCompany];
    });
    assert.deepEqual(results, [1, 1, 1]);
    assert.equal(
      await db.transaction((trx) => planningRevisions.getPlanningRevision(trx, 'a-studio')),
      1
    );
    assert.equal(
      await db.transaction((trx) => planningRevisions.advancePlanningRevision(trx, 'a-studio')),
      2
    );
  });

  test('rolls back a revision advance with the caller transaction', async ({ assert }) => {
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await planningRevisions.advancePlanningRevision(trx, 'a-studio');
          throw new Error('rollback');
        }),
      /rollback/
    );
    assert.equal(
      await db.transaction((trx) => planningRevisions.getPlanningRevision(trx, 'a-studio')),
      0
    );
    assert.isNull(
      await db.from('company_planning_revisions').where('company_id', 'a-studio').first()
    );
  });
});
