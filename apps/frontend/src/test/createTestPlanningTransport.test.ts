import { expect, it } from 'vitest';
import { seed } from '@capacitylens/shared/data/seed';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { createTestPlanningTransport } from './createTestPlanningTransport';
import { resetPlanningTransport, updatePlanningFixtureSource } from './planningTransportHandle';

it('an older read cannot discard a newer reset snapshot', async () => {
  const visible = emptyAppData();
  const data = seed();
  const first = {
    ...data,
    accounts: data.accounts.map((account) => ({ ...account, name: 'First' })),
  };
  const second = {
    ...data,
    accounts: data.accounts.map((account) => ({ ...account, name: 'Second' })),
  };
  const transport = createTestPlanningTransport(() => visible);
  const context = { identity: 'test', companyId: 'a-studio' };
  const signal = new AbortController().signal;
  resetPlanningTransport('a-studio', first, visible);
  const oldRead = transport.read(context, signal);
  resetPlanningTransport('a-studio', second, visible);
  await oldRead;
  const next = await transport.read(context, signal);
  expect(next.revision).toBe(2);
  expect(next.data.accounts[0]?.name).toBe('Second');
});

it('uses an explicit source update made after reset and before its first read', async () => {
  const visible = emptyAppData();
  const resetData = seed();
  const updatedData = {
    ...resetData,
    accounts: resetData.accounts.map((account) =>
      account.id === 'a-studio' ? { ...account, name: 'Explicit Fixture Update' } : account,
    ),
  };
  const transport = createTestPlanningTransport(() => visible);
  const context = { identity: 'test', companyId: 'a-studio' };
  const signal = new AbortController().signal;
  resetPlanningTransport(context.companyId, resetData, visible);
  updatePlanningFixtureSource(updatedData, visible);

  const snapshot = await transport.read(context, signal);

  expect(snapshot.data.accounts[0]?.name).toBe('Explicit Fixture Update');
});

it('reset removes retained commitments and restoration groups while keeping valid parent rows', async () => {
  let visible = seed();
  const transport = createTestPlanningTransport(() => visible);
  const context = { identity: 'test', companyId: 'a-studio' };
  const signal = new AbortController().signal;
  const original = visible.allocations.find((row) => row.accountId === context.companyId);
  if (!original) throw new Error('The sample company must contain an allocation.');
  resetPlanningTransport(context.companyId, visible, visible);
  const before = await transport.read(context, signal);
  const deleted = await transport.execute(
    context,
    {
      mutationId: crypto.randomUUID(),
      baseRevision: before.revision,
      intent: { operation: 'allocation.delete', id: original.id },
    },
    signal,
  );
  const handle = deleted.restoration.replacementGroupId;
  if (!handle) throw new Error('The delete must retain a restoration group.');
  visible = {
    ...visible,
    allocations: visible.allocations.filter((row) => row.id !== original.id),
  };
  resetPlanningTransport(context.companyId, visible, visible);
  const after = await transport.read(context, signal);
  await expect(transport.lookup(context, deleted.mutationId, signal)).resolves.toEqual({
    status: 'unknown',
    mutationId: deleted.mutationId,
  });
  await expect(
    transport.execute(
      context,
      {
        mutationId: crypto.randomUUID(),
        baseRevision: after.revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: handle },
      },
      signal,
    ),
  ).rejects.toMatchObject({ status: 409 });
});

it('keeps committed patch and refetch receipts in its source across later reads', async () => {
  const source = seed();
  const visible = emptyAppData();
  const transport = createTestPlanningTransport(() => visible);
  const context = { identity: 'test', companyId: 'a-studio' };
  const signal = new AbortController().signal;
  resetPlanningTransport(context.companyId, source, visible);
  const initial = await transport.read(context, signal);

  const allocation = source.allocations.find((row) => row.accountId === context.companyId);
  if (!allocation) throw new Error('The sample company must contain an allocation.');
  const patched = await transport.execute(
    context,
    {
      mutationId: crypto.randomUUID(),
      baseRevision: initial.revision,
      intent: { operation: 'allocation.update', id: allocation.id, changes: { hoursPerDay: 4 } },
    },
    signal,
  );
  expect(patched.projection.mode).toBe('patch');
  const afterPatch = await transport.read(context, signal);
  expect(afterPatch.data.allocations).toContainEqual(
    expect.objectContaining({
      id: allocation.id,
      hoursPerDay: 4,
    }),
  );

  const beforeRefetch = await transport.read(context, signal);
  const client = source.clients.find(
    (row) => row.accountId === context.companyId && row.name !== 'Internal',
  );
  if (!client) throw new Error('The sample company must contain a client.');
  const refetched = await transport.execute(
    context,
    {
      mutationId: crypto.randomUUID(),
      baseRevision: beforeRefetch.revision,
      intent: {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: client.id,
          changes: { isPrivate: true, codeName: 'Secret Client' },
        },
      },
    },
    signal,
  );
  expect(refetched.projection.mode).toBe('refetch');
  const afterRefetch = await transport.read(context, signal);
  expect(afterRefetch.data.clients).toContainEqual(
    expect.objectContaining({ id: client.id, isPrivate: true, codeName: 'Secret Client' }),
  );
});

it('accepts an explicit direct-fixture source update without resetting commitments', async () => {
  const visible = emptyAppData();
  const source = seed();
  const transport = createTestPlanningTransport(() => visible);
  const context = { identity: 'test', companyId: 'a-studio' };
  const signal = new AbortController().signal;
  resetPlanningTransport(context.companyId, source, visible);
  const before = await transport.read(context, signal);
  const allocation = source.allocations.find((row) => row.accountId === context.companyId);
  if (!allocation) throw new Error('The sample company must contain an allocation.');
  const deleted = await transport.execute(
    context,
    {
      mutationId: crypto.randomUUID(),
      baseRevision: before.revision,
      intent: { operation: 'allocation.delete', id: allocation.id },
    },
    signal,
  );
  const restorationGroupId = deleted.restoration.replacementGroupId;
  if (!restorationGroupId) throw new Error('The delete must retain a restoration group.');
  const updated = {
    ...source,
    accounts: source.accounts.map((account) =>
      account.id === context.companyId ? { ...account, name: 'Fixture Updated Co' } : account,
    ),
    allocations: source.allocations.filter((row) => row.id !== allocation.id),
  };
  updatePlanningFixtureSource(updated, visible);
  const afterFixtureUpdate = await transport.read(context, signal);
  expect(afterFixtureUpdate).toMatchObject({
    data: { accounts: [expect.objectContaining({ name: 'Fixture Updated Co' })] },
    revision: deleted.revision + 1,
  });
  await expect(transport.lookup(context, deleted.mutationId, signal)).resolves.toMatchObject({
    status: 'committed',
    restorationGroupId,
  });
  const restored = await transport.execute(
    context,
    {
      mutationId: crypto.randomUUID(),
      baseRevision: afterFixtureUpdate.revision,
      intent: { operation: 'planning.restoreGroup', restorationGroupId },
    },
    signal,
  );
  expect(restored.projection.mode).toBe('patch');
  const afterRestore = await transport.read(context, signal);
  expect(afterRestore.data.allocations.map(({ id }) => id)).toContain(allocation.id);
});
