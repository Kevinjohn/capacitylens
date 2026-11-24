import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  companyId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  loginAsMember,
  validationSentence,
} from '#tests/functional/planning/helpers';

const route = (path: string) => `/api/companies/${companyId}/${path}`;
/** Reads a success answer inside its `data` envelope and a refusal as it stands. */
const body = (response: { body(): unknown; status(): number }) =>
  (response.status() < 300 ? (response.body() as { data: unknown }).data : response.body()) as {
    code: string;
    revision: number;
  };
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
    const data = await readState(companyId, true);
    const allocation = data.allocations.find((row) => row.resourceId === 'r-pam')!;
    await db
      .from('allocations')
      .where('id', allocation.id)
      .update({ start_date: '2026-06-05', end_date: '2026-06-05', ignore_working_days: false });
    const { cookie } = await loginAsMember();
    const patch = (revision: number, changes: Record<string, unknown>) =>
      session(client.post(route('planning/mutations')), cookie)
        .json(input(revision, { operation: 'allocation.update', id: allocation.id, changes }))
        .send();
    const refused = await patch(0, { resourceId: 'r-alex' });
    refused.assertStatus(422);
    assert.isString(validationSentence(refused));
    let state = await readState(companyId, true);
    assert.equal(state.allocations.find((row) => row.id === allocation.id)!.resourceId, 'r-pam');

    const override = await patch(0, { ignoreWorkingDays: true });
    override.assertStatus(200);
    const reassigned = await patch(1, { resourceId: 'r-alex' });
    reassigned.assertStatus(200);
    assert.equal(body(reassigned).revision, 2);
    state = await readState(companyId, true);
    const saved = state.allocations.find((row) => row.id === allocation.id)!;
    assert.equal(saved.resourceId, 'r-alex');
    assert.isTrue(saved.ignoreWorkingDays);
    assert.equal(saved.startDate, '2026-06-05');

    const newRow = {
      ...newAllocation(state),
      resourceId: 'r-alex',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      ignoreWorkingDays: true,
    };
    const newBooking = await session(client.post(route('planning/mutations')), cookie)
      .json(input(2, { operation: 'allocation.create', allocation: newRow }))
      .send();
    newBooking.assertStatus(422);
    assert.isString(validationSentence(newBooking));
    await db.from('resources').where('id', 'r-pam').update({ first_available_date: '2026-06-08' });
    const before = await readState(companyId, true);
    const unavailable = await patch(2, { resourceId: 'r-pam' });
    unavailable.assertStatus(422);
    assert.isString(validationSentence(unavailable));
    assert.deepEqual(await readState(companyId, true), before);
    const canonical = await session(client.get(planningUrl), cookie).send();
    canonical.assertStatus(200);
    assert.equal(body(canonical).revision, 2);
  });
});
