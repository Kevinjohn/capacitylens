import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  companyId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
} from '#tests/functional/planning/helpers';
import app from '@adonisjs/core/services/app';
import { RestorationService } from '#services/planning/restoration_service';
import { insertProductRows } from '#tests/helpers/product_rows';
import { readState } from '#tests/helpers/state_fixture';
import {
  revision,
  targetTables,
  type Target,
  deleteTarget,
} from '#tests/helpers/planning/retained_rows';

const restoration = await app.container.make(RestorationService);

test.group('retained restoration reads', (suite) => {
  suite.setup(() => freshDatabase());
  suite.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('all five retained planning types stay hidden from ordinary and inactive-inclusive reads', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const seed = await readState(companyId, true);
    const now = new Date().toISOString();
    const ids: Record<Target, string> = {
      allocations: randomUUID(),
      timeOff: randomUUID(),
      closures: randomUUID(),
      phases: seed.phases[0]!.id,
      disciplines: seed.disciplines[0]!.id,
    };
    const allocation = {
      ...newAllocation(seed),
      id: ids.allocations,
      note: 'Gotham retained note',
    };
    await insertProductRows('allocations', [
      {
        ...allocation,
        companyId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await insertProductRows('timeOff', [
      {
        id: ids.timeOff,
        companyId,
        resourceId: seed.resources.find(
          (row) => row.companyId === companyId && row.kind === 'person'
        )!.id,
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        type: 'holiday',
        note: 'Gotham private note',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await insertProductRows('closures', [
      {
        id: ids.closures,
        companyId,
        name: 'Gotham retained closure',
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const insertedAllocation = await db.from('allocations').where('id', ids.allocations).first();
    assert.exists(insertedAllocation);

    const order: Target[] = ['allocations', 'timeOff', 'closures', 'phases', 'disciplines'];
    for (const [index, target] of order.entries()) {
      const deleted = await deleteTarget(client, cookie, target, ids[target], index);
      deleted.assertStatus(200);
      const row = await db.from(targetTables[target]).where('id', ids[target]).first();
      assert.exists(row, `${target} must remain physically present for Undo`);
      assert.isNotNull(row.deleted_at);
      assert.isString(row.deletion_group_id);
      const ledger = await db
        .from('deleted_rows')
        .where({ group_id: row.deletion_group_id, entity: target, row_id: ids[target] })
        .first();
      assert.exists(ledger);
      assert.deepEqual(JSON.parse(ledger.payload_json), { kind: 'row' });

      const locallyRead = await readState(companyId, true);
      assert.isFalse(locallyRead[target].some((item) => item.id === ids[target]));

      const planning = await session(
        client.visit('api.planning.show', { companyId }),
        cookie
      ).send();
      planning.assertStatus(200);
      assert.notInclude(planning.text(), ids[target]);
      assert.notInclude(planning.text(), 'deletionGroupId');
      assert.notInclude(planning.text(), 'deletion_group_id');

      const exported = await session(
        client.visit('api.company_state.show').qs({ companyId, includeInactive: '1' }),
        cookie
      ).send();
      exported.assertStatus(200);
      assert.notInclude(exported.text(), ids[target]);
      assert.notInclude(exported.text(), 'deletionGroupId');
      assert.notInclude(exported.text(), 'deletion_group_id');
    }
  });

  test('reusing a deleted allocation id purges only its old row and makes the old handle stale', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const data = await readState(companyId, true);
    const allocation = { ...newAllocation(data), note: 'Gotham retained note' };
    const created = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: await revision(),
        intent: { operation: 'allocation.create', allocation },
      })
      .send();
    created.assertStatus(200);
    const deleted = await deleteTarget(client, cookie, 'allocations', allocation.id, 1);
    deleted.assertStatus(200);
    const groupId = (deleted.body().data as { restoration: { replacementGroupId: string } })
      .restoration.replacementGroupId;
    const restoredRowBeforeReuse = await db.from('allocations').where('id', allocation.id).first();
    assert.exists(restoredRowBeforeReuse);
    assert.equal(restoredRowBeforeReuse.deletion_group_id, groupId);

    assert.equal(
      await db.transaction((trx) => restoration.countRestorableItems(trx, companyId)),
      1
    );
    const reused = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 2,
        intent: { operation: 'allocation.create', allocation },
      })
      .send();
    reused.assertStatus(200);
    const active = await db.from('allocations').where('id', allocation.id).first();
    assert.exists(active);
    assert.isNull(active.deleted_at);
    assert.isNull(active.deletion_group_id);
    assert.exists(await db.from('deleted_groups').where('group_id', groupId).first());
    const ledgerAfterReuse = await db.from('deleted_rows').where('group_id', groupId).first();
    assert.deepEqual(JSON.parse(ledgerAfterReuse.payload_json), { kind: 'row' });

    assert.equal(
      await db.transaction((trx) => restoration.countRestorableItems(trx, companyId)),
      0
    );
    const beforeRefusal = await readState(companyId, true);
    const refused = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 3,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send();
    refused.assertStatus(409);
    assert.deepEqual(await readState(companyId, true), beforeRefusal);
    const unconsumedGroup = await db.from('deleted_groups').where('group_id', groupId).first();
    assert.isNull(unconsumedGroup.consumed_at);
    assert.equal(await revision(), 3);
  });

  test('an empty expected-row ledger refuses restore without consuming or detaching the retained row', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const data = await readState(companyId, true);
    const allocation = newAllocation(data);
    await insertProductRows('allocations', [
      {
        ...allocation,
        companyId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    const deleted = await deleteTarget(client, cookie, 'allocations', allocation.id, 0);
    deleted.assertStatus(200);
    const groupId = (deleted.body().data as { restoration: { replacementGroupId: string } })
      .restoration.replacementGroupId;
    const rowsBefore = await readState(companyId, true);
    const markersBefore = await db
      .from('planning_mutations')
      .where('company_id', companyId)
      .select('*');
    const auditBefore = await db
      .from('audit_entries')
      .where({ company_id: companyId, entity: 'planning' })
      .select('*');
    await db.from('deleted_rows').where('group_id', groupId).delete();

    const refused = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send();

    refused.assertStatus(409);
    assert.deepEqual(await readState(companyId, true), rowsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId).select('*'),
      markersBefore
    );
    assert.deepEqual(
      await db
        .from('audit_entries')
        .where({ company_id: companyId, entity: 'planning' })
        .select('*'),
      auditBefore
    );
    const group = await db.from('deleted_groups').where('group_id', groupId).first();
    const retained = await db.from('allocations').where('id', allocation.id).first();
    assert.isNull(group.consumed_at);
    assert.isNotNull(retained.deleted_at);
    assert.equal(retained.deletion_group_id, groupId);
    assert.equal(await revision(), 1);
  });
});
