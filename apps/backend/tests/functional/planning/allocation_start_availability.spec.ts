import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import { readState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  companyId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  type Credential,
  loginAsMember,
} from '#tests/functional/planning/helpers';

const route = (path: string) => `/api/companies/${companyId}/${path}`;
/** Reads a success answer inside its `data` envelope and a refusal as it stands. */
const body = (response: { body(): unknown; status(): number }) =>
  (response.status() < 300 ? (response.body() as { data: unknown }).data : response.body()) as {
    code: string;
    error: string;
    revision: number;
  };
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
});

function mutate(client: ApiClient, cookie: Credential, revision: number, intent: object) {
  return session(client.post(route('planning/mutations')), cookie)
    .json(input(revision, intent as Record<string, unknown>))
    .send();
}

test.group('allocation start availability', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('a new allocation cannot start on the person’s time off', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember();
    const allocation = newAllocation(await readState(companyId, true));
    const timeOff = await mutate(client, cookie, 0, {
      operation: 'timeOff.create',
      timeOff: {
        id: randomUUID(),
        resourceId: allocation.resourceId,
        startDate: '2026-11-02',
        endDate: '2026-11-03',
        type: 'holiday',
      },
    });
    timeOff.assertStatus(200);
    const before = await readState(companyId, true);

    const refused = await mutate(client, cookie, 1, { operation: 'allocation.create', allocation });
    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    assert.match(body(refused).error, /time off or a company closure/);
    assert.deepEqual(await readState(companyId, true), before);

    const later = await mutate(client, cookie, 1, {
      operation: 'allocation.create',
      allocation: { ...allocation, id: randomUUID(), startDate: '2026-11-04' },
    });
    later.assertStatus(200);
  });

  test('a new allocation cannot start on a company closure', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember();
    const allocation = newAllocation(await readState(companyId, true));
    const closure = await mutate(client, cookie, 0, {
      operation: 'closure.create',
      id: randomUUID(),
      fields: { name: 'Founders day', startDate: '2026-11-02', endDate: '2026-11-02' },
    });
    closure.assertStatus(200);

    const refused = await mutate(client, cookie, 1, { operation: 'allocation.create', allocation });
    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
  });

  test('a reassignment cannot land a start on time off, even with the working-day override, while a same-person edit stays permissive', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember();
    const state = await readState(companyId, true);
    const allocation = newAllocation(state);
    const other = state.resources.find(
      (row) =>
        row.companyId === companyId &&
        row.kind === 'person' &&
        row.id !== allocation.resourceId &&
        !row.archivedAt &&
        !row.deletedAt
    )!;
    const created = await mutate(client, cookie, 0, {
      operation: 'allocation.create',
      allocation: { ...allocation, ignoreWorkingDays: true },
    });
    created.assertStatus(200);
    const ownTimeOff = await mutate(client, cookie, 1, {
      operation: 'timeOff.create',
      timeOff: {
        id: randomUUID(),
        resourceId: allocation.resourceId,
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        type: 'sick',
      },
    });
    ownTimeOff.assertStatus(200);
    const otherTimeOff = await mutate(client, cookie, 2, {
      operation: 'timeOff.create',
      timeOff: {
        id: randomUUID(),
        resourceId: other.id,
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        type: 'holiday',
      },
    });
    otherTimeOff.assertStatus(200);

    const sameResource = await mutate(client, cookie, 3, {
      operation: 'allocation.update',
      id: allocation.id,
      changes: { hoursPerDay: 4 },
    });
    sameResource.assertStatus(200);

    const reassigned = await mutate(client, cookie, 4, {
      operation: 'allocation.update',
      id: allocation.id,
      changes: { resourceId: other.id },
    });
    reassigned.assertStatus(400);
    assert.equal(body(reassigned).code, 'VALIDATION_ERROR');
    const dragged = await mutate(client, cookie, 4, {
      operation: 'allocation.reassign',
      id: allocation.id,
      resourceId: other.id,
      startDate: allocation.startDate,
      endDate: allocation.endDate,
    });
    dragged.assertStatus(400);
    assert.equal(body(dragged).code, 'VALIDATION_ERROR');
    const after = await readState(companyId, true);
    const saved = after.allocations.find((row) => row.id === allocation.id)!;
    assert.equal(saved.resourceId, allocation.resourceId);
  });
});
