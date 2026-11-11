import { expect, it } from 'vitest';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import { makeAccount, makeAppData, makeClient } from './fixtures';
import { createTestPlanningTransport } from './createTestPlanningTransport';
import { getStubPlanningTransport } from './planningTransportHandle';

const context = { identity: 'test', companyId: 'acct-one' };
const signal = new AbortController().signal;

function receipt(mutationId: string, revision: number): PlanningMutationSuccess {
  return {
    status: 'committed',
    mutationId,
    revision,
    restoration: { consumedGroupId: null, replacementGroupId: null },
    projection: { mode: 'patch', history: 'retain', changed: { upserts: [], removed: [] } },
  };
}

it('reads a reset snapshot scoped to its company at that company revision', async () => {
  const transport = createTestPlanningTransport();
  const client = makeClient({ id: 'c1', accountId: context.companyId });
  const other = makeClient({ id: 'c2', accountId: 'acct-two' });
  getStubPlanningTransport().reset(
    context.companyId,
    makeAppData({
      accounts: [makeAccount({ id: context.companyId }), makeAccount({ id: 'acct-two' })],
      clients: [client, other],
    }),
  );

  const snapshot = await transport.read(context, signal);

  expect(snapshot).toMatchObject({ revision: 0, canWrite: true });
  expect(snapshot.data.clients).toEqual([client]);
  expect(snapshot.data.accounts).toEqual([makeAccount({ id: context.companyId })]);
});

it('records the sent intent and applies an unvalidated single-row change', async () => {
  const transport = createTestPlanningTransport();
  getStubPlanningTransport().reset(context.companyId, makeAppData());
  const client = makeClient({ id: 'new-client', accountId: context.companyId });

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
  expect(response).toMatchObject({
    mutationId: 'create-client',
    revision: 1,
    projection: {
      mode: 'patch',
      history: 'retain',
      changed: { upserts: [{ entity: 'clients', row: client }] },
    },
  });
  const snapshot = await transport.read(context, signal);
  expect(snapshot.data.clients).toEqual([client]);
});

it('returns a queued response, preserves its canonical read data and exposes its commitment', async () => {
  const transport = createTestPlanningTransport();
  const stub = getStubPlanningTransport();
  stub.reset(context.companyId, makeAppData());
  const client = makeClient({ id: 'canonical-client', accountId: context.companyId });
  const queued = receipt('queued', 7);
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
  ).resolves.toEqual(queued);
  await expect(transport.lookup(context, 'queued', signal)).resolves.toEqual({
    status: 'committed',
    mutationId: 'queued',
    revision: 7,
  });
  const snapshot = await transport.read(context, signal);
  expect(snapshot.data.clients).toEqual([client]);
});

it('throws a queued refusal, records the intent, and requires responses for compound operations', async () => {
  const transport = createTestPlanningTransport();
  const stub = getStubPlanningTransport();
  stub.reset(context.companyId, makeAppData());
  const intent: PlanningIntent = { operation: 'allocation.createGroup', allocations: [] };
  const refusal = Object.assign(new Error('Server rejected the group'), { status: 400 });
  stub.failNext(refusal);

  await expect(
    transport.execute(context, { mutationId: 'refused', baseRevision: 0, intent }, signal),
  ).rejects.toBe(refusal);
  expect(stub.calls).toEqual([intent]);
  await expect(transport.lookup(context, 'refused', signal)).resolves.toEqual({
    status: 'unknown',
    mutationId: 'refused',
  });
  await expect(
    transport.execute(context, { mutationId: 'unanswered', baseRevision: 0, intent }, signal),
  ).rejects.toThrow('stub: queue a response for allocation.createGroup');
});

it('reset discards queued responses, failures, calls and recorded commitments', async () => {
  const transport = createTestPlanningTransport();
  const stub = getStubPlanningTransport();
  stub.reset(context.companyId, makeAppData());
  stub.respondNext(receipt('discarded-response', 5));
  stub.failNext(new Error('discarded-error'));
  await transport.execute(
    context,
    {
      mutationId: 'committed',
      baseRevision: 0,
      intent: { operation: 'settings.update', changes: { name: 'Updated' } },
    },
    signal,
  );

  stub.reset(
    context.companyId,
    makeAppData({ accounts: [makeAccount({ id: context.companyId, name: 'Reset' })] }),
  );

  expect(stub.calls).toEqual([]);
  await expect(transport.lookup(context, 'committed', signal)).resolves.toEqual({
    status: 'unknown',
    mutationId: 'committed',
  });
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
