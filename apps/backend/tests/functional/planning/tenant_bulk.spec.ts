import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { readState } from '#tests/helpers/state_fixture';
import type { AppData } from '@capacitylens/shared/types/entities';
import {
  accountId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js';

const otherAccountId = 'a-loft';
const requestBody = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
});

test.group('typed bulk writer tenant isolation', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  for (const scenario of [
    {
      name: 'allocation create-group',
      path: 'allocations/create-group',
      intent: (data: AppData) => ({
        operation: 'allocation.createGroup',
        allocation: newAllocation(data),
        repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-09' },
        occurrenceIds: [randomUUID()],
      }),
    },
    {
      name: 'allocation delete-group',
      path: 'allocations/delete-group',
      intent: (data: AppData) => ({
        operation: 'allocation.deleteGroup',
        ids: [data.allocations[0]!.id],
      }),
    },
    {
      name: 'time-off delete-group',
      path: 'time-off/delete-group',
      intent: (data: AppData) => ({
        operation: 'timeOff.deleteGroup',
        ids: [data.timeOff[0]!.id],
      }),
    },
    {
      name: 'time-off repeat',
      path: 'time-off/repeat',
      intent: (data: AppData) => ({
        operation: 'timeOff.repeat',
        timeOff: {
          id: randomUUID(),
          resourceId: data.timeOff[0]!.resourceId,
          startDate: '2026-11-09',
          endDate: '2026-11-09',
          type: 'holiday',
        },
        repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-16' },
        occurrenceIds: [randomUUID()],
      }),
    },
  ] as const) {
    test(`${scenario.name} changes only the caller's company`, async ({
      client,
      assert,
      cleanup,
    }) => {
      configureAuth(cleanup);
      const { cookie } = await signIn(client);
      const beforeOwn = await readState(accountId, true);
      const intent = scenario.intent(beforeOwn);
      const beforeOther = await readState(otherAccountId, true);
      const own = await session(client.post(`/api/accounts/${accountId}/${scenario.path}`), cookie)
        .json(requestBody(0, intent))
        .send();
      own.assertStatus(200);
      assert.notDeepEqual(await readState(accountId, true), beforeOwn);
      assert.deepEqual(await readState(otherAccountId, true), beforeOther);

      const foreign = await session(
        client.post(`/api/accounts/${otherAccountId}/${scenario.path}`),
        cookie
      )
        .json(requestBody(0, intent))
        .send();
      foreign.assertStatus(403);
      assert.deepEqual(await readState(otherAccountId, true), beforeOther);
    });
  }

  test("planning restore-group changes only the caller's company", async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const initial = await readState(accountId, true);
    const id = initial.allocations[0]!.id;
    const removed = await session(
      client.post(`/api/accounts/${accountId}/allocations/delete-group`),
      cookie
    )
      .json(requestBody(0, { operation: 'allocation.deleteGroup', ids: [id] }))
      .send();
    removed.assertStatus(200);
    const groupId = (removed.body() as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId;
    const intent = { operation: 'planning.restoreGroup', restorationGroupId: groupId };
    const beforeOwn = await readState(accountId, true);
    const beforeOther = await readState(otherAccountId, true);
    const restored = await session(
      client.post(`/api/accounts/${accountId}/planning/restore-group`),
      cookie
    )
      .json(requestBody(1, intent))
      .send();
    restored.assertStatus(200);
    assert.notDeepEqual(await readState(accountId, true), beforeOwn);
    assert.deepEqual(await readState(otherAccountId, true), beforeOther);

    const foreign = await session(
      client.post(`/api/accounts/${otherAccountId}/planning/restore-group`),
      cookie
    )
      .json(requestBody(0, intent))
      .send();
    foreign.assertStatus(403);
    assert.deepEqual(await readState(otherAccountId, true), beforeOther);
  });
});
