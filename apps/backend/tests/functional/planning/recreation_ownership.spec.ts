import { randomUUID } from 'node:crypto';
import type { ApiClient, ApiResponse } from '@japa/api-client';
import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning/contracts';
import { readState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  companyId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
  signInAgain,
} from '#tests/functional/planning/helpers';

const mutationsUrl = `/api/v1/companies/${companyId}/planning/mutations`;

interface SendPlanningOptions {
  client: ApiClient;
  cookie: string;
  path: string;
  baseRevision: number;
  intent: PlanningIntent;
}

async function sendPlanning({ client, cookie, path, baseRevision, intent }: SendPlanningOptions) {
  const response = await session(client.post(path), cookie)
    .json({ mutationId: randomUUID(), baseRevision, intent })
    .send();
  // Callers assert 200 before reading success fields; refusal bodies are compared as whole values.
  return response as ApiResponse<{ data: PlanningMutationSuccess }>;
}

async function readPlanningStorage() {
  return {
    allocations: await db.from('allocations').orderBy('id'),
    groups: await db.from('deleted_groups').orderBy('group_id'),
    rows: await db.from('deleted_rows').orderBy('group_id').orderBy('row_id'),
    revisions: await db.from('company_planning_revisions').orderBy('company_id'),
    receipts: await db.from('planning_mutations').orderBy('mutation_id'),
    audit: await db.from('audit_entries').where('entity', 'planning').orderBy('id'),
  };
}

test.group('retained id recreation ownership', (suite) => {
  suite.setup(() => freshDatabase());
  suite.each.setup(async () => {
    await resetPlanningFixture();
  });

  for (const attempt of ['another editor', 'another session'] as const) {
    test(`${attempt} cannot replace a pending deletion and its original session can still restore`, async ({
      client,
      assert,
      cleanup,
    }) => {
      configureAuth(cleanup);
      const owner = await signIn(client, 'editor');
      const allocation = newAllocation(await readState(companyId, true));
      const created = await sendPlanning({
        client,
        cookie: owner.cookie,
        path: mutationsUrl,
        baseRevision: 0,
        intent: { operation: 'allocation.create', allocation },
      });
      created.assertStatus(200);
      const deleted = await sendPlanning({
        client,
        cookie: owner.cookie,
        path: mutationsUrl,
        baseRevision: 1,
        intent: { operation: 'allocation.delete', id: allocation.id },
      });
      deleted.assertStatus(200);
      const groupId = String(deleted.body().data.restoration.replacementGroupId);
      let cookie: string;
      if (attempt === 'another editor') {
        const editor = await signIn(client, 'editor');
        cookie = editor.cookie;
      } else {
        cookie = await signInAgain(client, owner.email);
      }
      const snapshot = await session(client.get(planningUrl), cookie).send();
      snapshot.assertStatus(200);
      assert.equal(snapshot.body().data.access.role, 'editor');
      assert.isTrue(snapshot.body().data.access.canWrite);
      assert.equal(snapshot.body().data.revision, 2);
      const before = await readPlanningStorage();
      const refused = await sendPlanning({
        client,
        cookie,
        path: mutationsUrl,
        baseRevision: 2,
        intent: { operation: 'allocation.create', allocation: { ...allocation, hoursPerDay: 6 } },
      });
      refused.assertStatus(422);
      assert.deepEqual(refused.body(), { errors: [{ message: 'The record already exists.' }] });
      assert.deepEqual(await readPlanningStorage(), before);
      const restored = await sendPlanning({
        client,
        cookie: owner.cookie,
        path: mutationsUrl,
        baseRevision: 2,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      });
      restored.assertStatus(200);
      assert.equal(restored.body().data.revision, 3);
      const row = await db.from('allocations').where('id', allocation.id).first();
      assert.isNull(row.deleted_at);
      assert.equal(Number(row.hours_per_day), allocation.hoursPerDay);
    });
  }

  test('the deleting session can recreate its retained id and restore cannot overwrite the replacement', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client, 'editor');
    const allocation = newAllocation(await readState(companyId, true));
    const created = await sendPlanning({
      client,
      cookie,
      path: mutationsUrl,
      baseRevision: 0,
      intent: { operation: 'allocation.create', allocation },
    });
    created.assertStatus(200);
    const deleted = await sendPlanning({
      client,
      cookie,
      path: mutationsUrl,
      baseRevision: 1,
      intent: { operation: 'allocation.delete', id: allocation.id },
    });
    deleted.assertStatus(200);
    const groupId = String(deleted.body().data.restoration.replacementGroupId);
    const recreated = await sendPlanning({
      client,
      cookie,
      path: mutationsUrl,
      baseRevision: 2,
      intent: { operation: 'allocation.create', allocation: { ...allocation, hoursPerDay: 6 } },
    });
    recreated.assertStatus(200);
    assert.equal(recreated.body().data.revision, 3);
    const replacement = await db.from('allocations').where('id', allocation.id).first();
    assert.isNull(replacement.deleted_at);
    assert.equal(Number(replacement.hours_per_day), 6);
    const before = await readPlanningStorage();
    const restored = await sendPlanning({
      client,
      cookie,
      path: mutationsUrl,
      baseRevision: 3,
      intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
    });
    restored.assertStatus(409);
    assert.deepEqual(await readPlanningStorage(), before);
  });
});
