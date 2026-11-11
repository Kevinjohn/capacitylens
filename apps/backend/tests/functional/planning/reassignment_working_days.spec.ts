import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#services/state_repository';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  accountId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js';

const route = (path: string) => `/api/accounts/${accountId}/${path}`;
const body = (response: { body(): unknown }) =>
  response.body() as { code: string; revision: number };
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
});

test.group('reassignment working-day override', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('the override permits reassignment on a non-working day but never bypasses availability or the new-booking start rule', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(accountId, true);
    const allocation = data.allocations.find((row) => row.resourceId === 'r-pam')!;
    await db
      .from('allocations')
      .where('id', allocation.id)
      .update({ start_date: '2026-06-05', end_date: '2026-06-05', ignore_weekends: 'false' });
    const { cookie } = await signIn(client);
    const patch = (revision: number, changes: Record<string, unknown>) =>
      session(client.patch(route(`allocations/${allocation.id}`)), cookie)
        .json(input(revision, { operation: 'allocation.update', id: allocation.id, changes }))
        .send();
    const refused = await patch(0, { resourceId: 'r-alex' });
    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    let state = await readState(accountId, true);
    assert.equal(state.allocations.find((row) => row.id === allocation.id)!.resourceId, 'r-pam');

    const override = await patch(0, { ignoreWeekends: true });
    override.assertStatus(200);
    const reassigned = await patch(1, { resourceId: 'r-alex' });
    reassigned.assertStatus(200);
    assert.equal(body(reassigned).revision, 2);
    state = await readState(accountId, true);
    const saved = state.allocations.find((row) => row.id === allocation.id)!;
    assert.equal(saved.resourceId, 'r-alex');
    assert.isTrue(saved.ignoreWeekends);
    assert.equal(saved.startDate, '2026-06-05');

    const newRow = {
      ...newAllocation(state),
      resourceId: 'r-alex',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      ignoreWeekends: true,
    };
    const newBooking = await session(client.post(route('allocations')), cookie)
      .json(input(2, { operation: 'allocation.create', allocation: newRow }))
      .send();
    newBooking.assertStatus(400);
    assert.equal(body(newBooking).code, 'VALIDATION_ERROR');
    await db.from('resources').where('id', 'r-pam').update({ first_available_date: '2026-06-08' });
    const before = await readState(accountId, true);
    const unavailable = await patch(2, { resourceId: 'r-pam' });
    unavailable.assertStatus(400);
    assert.equal(body(unavailable).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(accountId, true), before);
    const canonical = await session(client.get(planningUrl), cookie).send();
    canonical.assertStatus(200);
    assert.equal(body(canonical).revision, 2);
  });
});
