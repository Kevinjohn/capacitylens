import { expect, it } from 'vitest';
import { seed } from '@capacitylens/shared/data/seed';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { createTestPlanningTransport } from './createTestPlanningTransport';
import { resetPlanningTransport } from './planningTransportHandle';

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
