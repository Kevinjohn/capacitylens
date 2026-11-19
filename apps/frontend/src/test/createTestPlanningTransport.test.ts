import { expect, it } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import { makeCompany, makeAppData, makeClient, requireFullSnapshot } from './fixtures';
import { createTestPlanningTransport } from './createTestPlanningTransport';
import { makeReceipt } from './planning/makeReceipt';
import { getStubPlanningTransport } from './planningTransportHandle';

const context = { identity: 'test', companyId: 'acct-one' };
const signal = new AbortController().signal;

it('reads a reset snapshot scoped to its company at that company revision', async () => {
  const transport = createTestPlanningTransport();
  const client = makeClient({ id: 'c1', companyId: context.companyId });
  const other = makeClient({ id: 'c2', companyId: 'acct-two' });
  getStubPlanningTransport().reset(
    context.companyId,
    makeAppData({
      accounts: [makeCompany({ id: context.companyId }), makeCompany({ id: 'acct-two' })],
      clients: [client, other],
    }),
  );

  const snapshot = requireFullSnapshot(await transport.read(context, signal));

  expect(snapshot).toMatchObject({ revision: 0, authority: { canWrite: true } });
  expect(snapshot.data.clients).toEqual([client]);
  expect(snapshot.data.accounts).toEqual([makeCompany({ id: context.companyId })]);
});

it('records the sent intent and applies an unvalidated single-row change', async () => {
  const transport = createTestPlanningTransport();
  getStubPlanningTransport().reset(context.companyId, makeAppData());
  const client = makeClient({ id: 'new-client', companyId: context.companyId });

  const response = await transport.execute(
    context,
    {
      mutationId: 'create-client',
      baseRevision: 0,
      intent: {
        operation: 'catalogue.create',
        entity: { entity: 'clients', id: client.id, fields: client },
      },
    },
    signal,
  );

  expect(getStubPlanningTransport().calls).toEqual([
    { operation: 'catalogue.create', entity: { entity: 'clients', id: client.id, fields: client } },
  ]);
  expect(response).toEqual({
    status: 'committed',
    mutationId: 'create-client',
    revision: 1,
    restoration: { consumedGroupId: null, replacementGroupId: null },
    changes: { upserts: [{ entity: 'clients', row: client }], removed: [] },
  });
  const snapshot = requireFullSnapshot(await transport.read(context, signal));
  expect(snapshot.data.clients).toEqual([client]);
});

it('returns a queued response, preserves its canonical read data and exposes its commitment', async () => {
  const transport = createTestPlanningTransport();
  const stub = getStubPlanningTransport();
  stub.reset(context.companyId, makeAppData());
  const client = makeClient({ id: 'canonical-client', companyId: context.companyId });
  const queued = makeReceipt('queued', 7);
  stub.respondNext(queued, makeAppData({ clients: [client] }));

  await expect(
    transport.execute(
      context,
      {
        mutationId: 'queued',
        baseRevision: 0,
        intent: { operation: 'settings.update', changes: { name: 'Canon' } },
      },
      signal,
    ),
  ).resolves.toEqual({
    ...queued,
    changes: { upserts: [{ entity: 'clients', row: client }], removed: [] },
  });
  const snapshot = requireFullSnapshot(await transport.read(context, signal));
  expect(snapshot.data.clients).toEqual([client]);
});

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
    occurrenceIds: ['a-2'],
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
    makeAppData({ accounts: [makeCompany({ id: context.companyId, name: 'Reset' })] }),
  );

  expect(stub.calls).toEqual([]);
  await expect(transport.read(context, signal)).resolves.toMatchObject({
    revision: 0,
    data: { accounts: [{ name: 'Reset' }] },
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
    makeAppData({ accounts: [makeCompany({ id: context.companyId, name: 'Wayne' })] }),
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
    return { name: snapshot.data.accounts[0]?.name, history: snapshot.history };
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
