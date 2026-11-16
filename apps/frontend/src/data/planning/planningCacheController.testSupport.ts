import { createStore } from 'zustand/vanilla';
import { expect, vi } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { Account, AppData } from '@capacitylens/shared/types/entities';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { createPlanningCacheController, createPlanningCacheState } from './planningCacheController';
import type { PlanningCacheState, PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { getMasqueradeContextToken } from '@/auth/masqueradeContext';
import { makeAccount } from '@/test/fixtures';

export const context = { identity: 'actor-1', companyId: 'company-1' };
export const intent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
} as const;
export const inverse = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-20' },
} as const;
const makeState = (): PlanningCacheState => createPlanningCacheState();
export const canonicalData = (accountOverrides: Partial<Account> = {}): AppData => ({
  ...emptyAppData(),
  accounts: [makeAccount({ id: context.companyId, ...accountOverrides })],
});
export const success = (mutationId: string, revision: number): PlanningMutationSuccess => ({
  status: 'committed',
  mutationId,
  revision,
  restoration: { consumedGroupId: null, replacementGroupId: null },
  projection: { mode: 'patch', history: 'retain', changed: { upserts: [], removed: [] } },
});

export function harness(transport: PlanningTransport) {
  const store = createStore<PlanningCacheState>(() => makeState());
  const snapshots: PlanningSnapshot[] = [];
  let serverSnapshot: PlanningSnapshot = { revision: 0, canWrite: true, data: canonicalData() };
  const read = vi.fn(
    async (clientContext: Parameters<PlanningTransport['read']>[0], signal: AbortSignal) => {
      const snapshot = snapshots.shift();
      if (snapshot) {
        serverSnapshot = snapshot;
        return snapshot;
      }
      const result: unknown = await transport.read(clientContext, signal);
      if (typeof result === 'object' && result !== null) return result as PlanningSnapshot;
      return serverSnapshot;
    },
  );
  let id = 0;
  const controller = createPlanningCacheController({
    readMasqueradeContextToken: getMasqueradeContextToken,
    getState: store.getState,
    setState: store.setState,
    transport: {
      ...transport,
      read,
      async execute(...args) {
        const receipt = await transport.execute(...args);
        // A malformed reply may carry no receipt; pass it through for the controller to judge.
        const revision = (receipt as PlanningMutationSuccess | null)?.revision;
        if (revision !== undefined) serverSnapshot = { ...serverSnapshot, revision };
        return receipt;
      },
    },
    createMutationId: vi.fn(() => `mutation-${++id}`),
  });
  return {
    controller,
    state: store.getState,
    async readSnapshot(snapshot: PlanningSnapshot) {
      snapshots.push(snapshot);
      return controller.refresh();
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function uncertainHarness() {
  const execute = vi
    .fn<PlanningTransport['execute']>()
    .mockRejectedValue(new TypeError('response lost'));
  const read = vi
    .fn<PlanningTransport['read']>()
    .mockResolvedValue({ revision: 2, canWrite: true, data: canonicalData(), accessKey: 'owner' });
  const lookup = vi.fn<PlanningTransport['lookup']>();
  const h = harness({ execute, read, lookup });
  h.controller.setContext(context);
  await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData(), accessKey: 'owner' });
  await expect(h.controller.execute(h.controller.begin(), intent, inverse)).rejects.toMatchObject({
    uncertain: true,
  });
  return { ...h, read, lookup };
}
