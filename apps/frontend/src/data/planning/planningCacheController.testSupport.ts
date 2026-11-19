import { createStore } from 'zustand/vanilla';
import { vi } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { Company, AppData, ISODate } from '@capacitylens/shared/types/entities';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { createPlanningCacheController, createPlanningCacheState } from './planningCacheController';
import type { PlanningCacheState, PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { getMasqueradeContextToken } from '@/api/masqueradeContext';
import { makeCompany } from '@/test/fixtures';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makeReceipt } from '@/test/planning/makeReceipt';
import { createServerHistoryModel } from '@/test/planning/serverHistoryModel';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

export { makeReceipt };

export const context = { identity: 'actor-1', companyId: 'company-1' };
export const intent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
} as const;
const makeState = (): PlanningCacheState => createPlanningCacheState();
/** The company date every canonical read in these tests carries. */
export const companyToday: ISODate = '2026-06-03';
export const makeCanonicalData = (companyOverrides: Partial<Company> = {}): AppData => ({
  ...emptyAppData(),
  accounts: [makeCompany({ id: context.companyId, ...companyOverrides })],
});

/**
 * A controller over `transport`. Reads come from queued snapshots, then the transport, then the
 * latest known server state; each carries the history the server model reports for the reading page
 * unless the snapshot names its own. Undo and Redo default to that model when the transport has none.
 */
export function createHarness(
  transport: Pick<PlanningTransport, 'read' | 'execute'> &
    Partial<Pick<PlanningTransport, 'undo' | 'redo'>>,
) {
  const store = createStore<PlanningCacheState>(() => makeState());
  const snapshots: PlanningSnapshot[] = [];
  let serverSnapshot: PlanningSnapshot = {
    revision: 0,
    authority: makePlanningAuthority(),
    data: makeCanonicalData(),
    today: companyToday,
    capacity: emptyCapacity(),
  };
  const history = createServerHistoryModel();
  const applyHistory = (snapshot: PlanningSnapshot, historyId: string | undefined) =>
    snapshot.history || typeof snapshot.revision !== 'number'
      ? snapshot
      : { ...snapshot, history: history.report(historyId, snapshot.revision) };
  const read = vi.fn<PlanningTransport['read']>(async (clientContext, signal, request) => {
    const snapshot = snapshots.shift();
    if (snapshot) {
      serverSnapshot = snapshot;
      return applyHistory(snapshot, request?.historyId);
    }
    const result: unknown = await transport.read(clientContext, signal, request);
    if (typeof result === 'object' && result !== null) {
      return applyHistory(result as PlanningSnapshot, request?.historyId);
    }
    return applyHistory(serverSnapshot, request?.historyId);
  });
  const step =
    (kind: 'undo' | 'redo'): PlanningTransport['undo'] =>
    async (clientContext, historyStep, signal) => {
      const own = transport[kind];
      if (own) return own(clientContext, historyStep, signal);
      const revision = historyStep.baseRevision + 1;
      history.step(kind, historyStep.historyId, historyStep.baseRevision, revision);
      serverSnapshot = { ...serverSnapshot, revision };
      return makeReceipt(historyStep.mutationId, revision);
    };
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
        if (revision !== undefined) {
          serverSnapshot = { ...serverSnapshot, revision };
          history.committed(args[1].historyId, args[1].baseRevision, revision);
        }
        return receipt;
      },
      undo: step('undo'),
      redo: step('redo'),
    },
    createMutationId: vi.fn(() => `mutation-${++id}`),
  });
  return {
    controller,
    read,
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
