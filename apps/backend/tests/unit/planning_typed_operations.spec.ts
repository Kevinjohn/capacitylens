import { test } from '@japa/runner';
import { randomUUID } from 'node:crypto';
import { freshDatabase } from '../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { readStateWithClient } from '#services/state_repository';
import { readState, resetState } from '#tests/helpers/state_fixture';
import { executePlanningIntent, PlanningOperationError } from '#services/planning/execute';
import type { PlanningIntent } from '#validators/planning/contracts';
import type { PlanningCapabilities } from '#services/planning/data_policy';

const owner: PlanningCapabilities = {
  role: 'owner',
  canWrite: true,
  canSeePrivateNames: true,
  canSeeTimeOffNote: true,
};

async function execute(intent: PlanningIntent) {
  await db.transaction(async (trx) => {
    const data = await readStateWithClient(trx, 'a-studio', true);
    await executePlanningIntent({
      trx,
      companyId: 'a-studio',
      intent,
      capabilities: owner,
      data,
      identity: { actorId: 'u-bruce', sessionId: 1, mutationId: randomUUID() },
    });
  });
}

async function refused(intent: PlanningIntent) {
  try {
    await execute(intent);
  } catch (error) {
    if (error instanceof PlanningOperationError) return error;
    throw error;
  }
  throw new Error('Expected the planning intent to be refused.');
}

const makeAllocation = (
  source: Awaited<ReturnType<typeof readState>>['allocations'][number],
  id: string,
  startDate: string
) => ({
  id,
  resourceId: source.resourceId,
  activityId: source.activityId,
  projectId: source.projectId,
  startDate,
  endDate: startDate,
  hoursPerDay: source.hoursPerDay,
  status: source.status,
  note: source.note,
  task: source.task,
  ignoreWorkingDays: source.ignoreWorkingDays,
});

test.group('typed allocation group and lifecycle operations', (group) => {
  group.setup(() => freshDatabase());

  test('creates one allocation series and allows only later occurrences to start on a nonworking day', async ({
    assert,
  }) => {
    await resetState('single');
    const before = await readState('a-studio', true);
    const source = before.allocations.find((allocation) => {
      const resource = before.resources.find((row) => row.id === allocation.resourceId);
      return (
        resource?.kind === 'person' &&
        resource.workingDays.includes(4) &&
        !resource.workingDays.includes(0)
      );
    })!;
    const firstId = randomUUID();

    // Thursday 1 October repeats on the first of each month; 1 November is a Sunday.
    await execute({
      operation: 'allocation.createGroup',
      allocation: makeAllocation(source, firstId, '2026-10-01'),
      repeat: { pattern: { kind: 'monthly-date' }, until: '2026-11-01' },
    });

    const after = await readState('a-studio', true);
    const first = after.allocations.find((row) => row.id === firstId)!;
    // The server minted the later occurrence's id.
    const second = after.allocations.find(
      (row) => row.seriesId === first.seriesId && row.id !== firstId
    )!;
    assert.isString(first.seriesId);
    assert.equal(first.seriesId, second.seriesId);
    assert.notEqual(first.seriesId, source.seriesId);
    assert.equal(second.startDate, '2026-11-01');

    const refusedFirstId = randomUUID();
    await assert.rejects(
      () =>
        execute({
          operation: 'allocation.createGroup',
          allocation: makeAllocation(source, refusedFirstId, '2026-10-25'),
          repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-01' },
        }),
      PlanningOperationError
    );
    const unchanged = await readState('a-studio', true);
    assert.isFalse(unchanged.allocations.some((row) => row.id === refusedFirstId));
    assert.lengthOf(unchanged.allocations, after.allocations.length);
  });

  test('archives and unarchives catalogue and resource rows through shared lifecycle rules', async ({
    assert,
  }) => {
    await resetState('single');
    const before = await readState('a-studio', true);
    const client = before.clients.find((row) => row.builtin !== true)!;
    const resource = before.resources.find((row) => row.kind === 'person')!;
    const oldClientRevision = client.updatedAt;

    await execute({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    });
    let after = await readState('a-studio', true);
    const archivedClient = after.clients.find((row) => row.id === client.id)!;
    assert.isString(archivedClient.archivedAt);
    assert.notEqual(archivedClient.updatedAt, oldClientRevision);

    await execute({ operation: 'resource.archive', id: resource.id });
    await execute({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: client.id },
    });
    await execute({ operation: 'resource.unarchive', id: resource.id });
    after = await readState('a-studio', true);
    assert.isNull(after.clients.find((row) => row.id === client.id)?.archivedAt);
    assert.isNull(after.resources.find((row) => row.id === resource.id)?.archivedAt);
  });

  test('refuses repeated archive, active unarchive, built-in archive, and tombstone unarchive', async ({
    assert,
  }) => {
    await resetState('single');
    const before = await readState('a-studio', true);
    const client = before.clients.find((row) => row.builtin !== true)!;
    const internal = before.clients.find((row) => row.builtin === true)!;

    const activeUnarchive = await refused({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: client.id },
    });
    assert.equal(activeUnarchive.status, 400);
    assert.equal(activeUnarchive.code, 'NO_CHANGE');

    const protectedArchive = await refused({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: internal.id },
    });
    assert.equal(protectedArchive.status, 409);
    assert.isNull(protectedArchive.code);

    await execute({ operation: 'catalogue.archive', entity: { entity: 'clients', id: client.id } });
    const archivedState = await readState('a-studio', true);
    const archived = archivedState.clients.find((row) => row.id === client.id)!;
    const repeatedArchive = await refused({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    });
    assert.equal(repeatedArchive.status, 400);
    assert.equal(repeatedArchive.code, 'NO_CHANGE');
    const afterRepeatedArchiveState = await readState('a-studio', true);
    const afterRepeatedArchive = afterRepeatedArchiveState.clients.find(
      (row) => row.id === client.id
    )!;
    assert.equal(afterRepeatedArchive.archivedAt, archived.archivedAt);
    assert.equal(afterRepeatedArchive.updatedAt, archived.updatedAt);

    await db.from('clients').where({ id: client.id, company_id: 'a-studio' }).update({
      deleted_at: '2026-10-20T12:00:00.000Z',
    });
    const tombstoneUnarchive = await refused({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: client.id },
    });
    assert.equal(tombstoneUnarchive.status, 400);
    assert.equal(tombstoneUnarchive.code, 'VALIDATION_ERROR');
    const after = await readState('a-studio', true);
    assert.equal(
      after.clients.find((row) => row.id === client.id)?.deletedAt,
      '2026-10-20T12:00:00.000Z'
    );
  });
});
