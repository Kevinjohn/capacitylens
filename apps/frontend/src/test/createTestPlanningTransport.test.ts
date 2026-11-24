import { expect, it } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import { makeCompany, makeAppData, requireFullSnapshot } from './fixtures';
import { createTestPlanningTransport } from './createTestPlanningTransport';
import { makeReceipt } from './planning/makeReceipt';
import { getStubPlanningTransport } from './planningTransportHandle';

const context = { identity: 'test', companyId: 'acct-one' };
const signal = new AbortController().signal;

it('throws a queued refusal, records the intent, and requires responses for compound operations', async () => {
  const transport = createTestPlanningTransport();
  const stub = getStubPlanningTransport();
  stub.reset(context.companyId, makeAppData());
  const intent: PlanningIntent = {
    operation: 'allocation.createGroup',
    allocation: {
      id: 'a-1',
      resourceId: 'r-1',
      activityId: 't-1',
      startDate: '2026-06-01',
      endDate: '2026-06-01',
      hoursPerDay: 8,
      status: 'confirmed',
    },
    repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-06-08' },
  };
  const refusal = Object.assign(new Error('Server rejected the group'), { status: 400 });
  stub.failNext(refusal);

  await expect(
    transport.execute(context, { mutationId: 'refused', baseRevision: 0, intent }, signal),
  ).rejects.toBe(refusal);
  expect(stub.calls).toEqual([intent]);
  await expect(
    transport.execute(context, { mutationId: 'unanswered', baseRevision: 0, intent }, signal),
  ).rejects.toThrow('stub: queue a response for allocation.createGroup');
});

it('reset discards queued responses, failures and calls', async () => {
  const transport = createTestPlanningTransport();
  const stub = getStubPlanningTransport();
  stub.reset(context.companyId, makeAppData());
  stub.respondNext(makeReceipt('committed', 5));
  await transport.execute(
    context,
    {
      mutationId: 'committed',
      baseRevision: 0,
      intent: { operation: 'settings.update', changes: { name: 'Updated' } },
    },
    signal,
  );

  await expect(transport.read(context, signal)).resolves.toMatchObject({ revision: 5 });
  stub.respondNext(makeReceipt('discarded-response', 8));
  stub.failNext(new Error('discarded-error'));

  stub.reset(
    context.companyId,
    makeAppData({ companies: [makeCompany({ id: context.companyId, name: 'Reset' })] }),
  );

  expect(stub.calls).toEqual([]);
  await expect(transport.read(context, signal)).resolves.toMatchObject({
    revision: 0,
    data: { companies: [{ name: 'Reset' }] },
  });
  await expect(
    transport.execute(
      context,
      {
        mutationId: 'fresh',
        baseRevision: 0,
        intent: { operation: 'settings.update', changes: { name: 'Fresh' } },
      },
      signal,
    ),
  ).resolves.toMatchObject({ revision: 1 });
});

it('lets one page undo two of its own changes and ends that history when another page writes', async () => {
  const transport = createTestPlanningTransport();
  getStubPlanningTransport().reset(
    context.companyId,
    makeAppData({ companies: [makeCompany({ id: context.companyId, name: 'Wayne' })] }),
  );
  const rename = (name: string, baseRevision: number, historyId: string) =>
    transport.execute(
      context,
      {
        mutationId: `rename-${name}`,
        baseRevision,
        historyId,
        intent: { operation: 'settings.update', changes: { name } },
      },
      signal,
    );
  const readAs = async (historyId: string) => {
    const snapshot = requireFullSnapshot(await transport.read(context, signal, { historyId }));
    return { name: snapshot.data.companies[0]?.name, history: snapshot.history };
  };

  await rename('Stark', 0, 'page-a');
  await rename('Kent', 1, 'page-a');
  await transport.undo(
    context,
    { mutationId: 'undo-1', baseRevision: 2, historyId: 'page-a' },
    signal,
  );
  await transport.undo(
    context,
    { mutationId: 'undo-2', baseRevision: 3, historyId: 'page-a' },
    signal,
  );
  await expect(readAs('page-a')).resolves.toEqual({
    name: 'Wayne',
    history: { canUndo: false, canRedo: true },
  });

  await rename('Prince', 4, 'page-b');
  await expect(readAs('page-a')).resolves.toEqual({
    name: 'Prince',
    history: { canUndo: false, canRedo: false },
  });
  await expect(
    transport.undo(context, { mutationId: 'undo-3', baseRevision: 5, historyId: 'page-a' }, signal),
  ).rejects.toThrow('There is nothing to undo.');
});
