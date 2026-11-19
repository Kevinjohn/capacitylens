import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import { readPlanningProblem } from './planningNotices';
import {
  context,
  intent,
  canonicalData,
  companyToday,
  success,
  harness,
} from './planningCacheController.testSupport';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

afterEach(() => setMasqueradeContextToken(null));

type Execute = ReturnType<typeof vi.fn<PlanningTransport['execute']>>;

const lostReplies: Array<{ name: string; lose: (execute: Execute) => void }> = [
  {
    name: 'an empty receipt',
    lose: (execute) => execute.mockResolvedValueOnce(null as unknown as PlanningMutationSuccess),
  },
  {
    name: 'a network failure',
    lose: (execute) => execute.mockRejectedValueOnce(new TypeError('offline')),
  },
  { name: 'HTTP 408', lose: (execute) => execute.mockRejectedValueOnce({ status: 408 }) },
  { name: 'HTTP 503', lose: (execute) => execute.mockRejectedValueOnce({ status: 503 }) },
  {
    name: 'a reused mutation id',
    lose: (execute) => execute.mockRejectedValueOnce({ status: 409, code: 'MUTATION_ID_REUSED' }),
  },
];

const serverData = canonicalData({ name: 'Wayne Enterprises' });
const serverSnapshot: PlanningSnapshot = {
  revision: 3,
  authority: makePlanningAuthority(),
  data: serverData,
  today: companyToday,
  capacity: emptyCapacity(),
};

type Read = ReturnType<typeof vi.fn<PlanningTransport['read']>>;

/** One acknowledged write with an Undo entry, then a second write whose reply is lost and the
 * server reads that `nextReads` queues. */
async function afterLostReply(lose: (execute: Execute) => void, nextReads: (read: Read) => void) {
  const read = vi.fn<PlanningTransport['read']>();
  const execute = vi
    .fn<PlanningTransport['execute']>()
    .mockImplementationOnce(async (_context, execution) => success(execution.mutationId, 2));
  const h = harness({ execute, read });
  h.controller.setContext(context);
  await h.readSnapshot({
    revision: 1,
    authority: makePlanningAuthority(),
    data: canonicalData(),
    today: companyToday,
    capacity: emptyCapacity(),
  });
  await h.controller.execute(h.controller.begin(), intent);
  expect(h.state().planning.history.canUndo).toBe(true);
  lose(execute);
  nextReads(read);
  const readsBefore = read.mock.calls.length;
  await expect(h.controller.execute(h.controller.begin(), intent)).rejects.toMatchObject({
    uncertain: true,
  });
  return { h, execute, reads: read.mock.calls.length - readsBefore };
}

describe('planning write whose reply was lost', () => {
  it.each(lostReplies)(
    'after $name, shows the server state and asks the person to check, without resending',
    async ({ lose }) => {
      const { h, execute, reads } = await afterLostReply(lose, (read) =>
        read.mockResolvedValueOnce(serverSnapshot),
      );
      expect(execute).toHaveBeenCalledTimes(2);
      expect(reads).toBe(1);
      expect(h.state().data).toEqual(serverData);
      expect(h.state().planning).toMatchObject({
        phase: { kind: 'ready', lastWrite: { kind: 'unconfirmed', mutationId: 'mutation-2' } },
        revision: 3,
        history: { canUndo: false, canRedo: false },
      });
      expect(readPlanningProblem(h.state().planning)).toBe('unconfirmed');

      execute.mockImplementationOnce(async (_context, execution) =>
        success(execution.mutationId, 4),
      );
      await h.controller.execute(h.controller.begin(), intent);
      expect(h.state().planning.phase).toMatchObject({
        kind: 'ready',
        lastWrite: { kind: 'acknowledged', revision: 4 },
      });
      expect(readPlanningProblem(h.state().planning)).toBeNull();
      expect(execute).toHaveBeenCalledTimes(3);
    },
  );

  it('clears undo history even when the server has not yet committed the change', async () => {
    const { h, execute } = await afterLostReply(
      (execute) => execute.mockRejectedValueOnce({ status: 408 }),
      (read) =>
        read.mockResolvedValueOnce({
          revision: 2,
          authority: makePlanningAuthority(),
          data: canonicalData(),
          today: companyToday,
          capacity: emptyCapacity(),
        }),
    );
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'ready', lastWrite: { kind: 'unconfirmed', mutationId: 'mutation-2' } },
      revision: 2,
      history: { canUndo: false, canRedo: false },
    });
    // The lost write named the page's history; the read after it names a new, empty one.
    const lostHistoryId = execute.mock.calls[1]?.[1].historyId;
    expect(lostHistoryId).toEqual(expect.any(String));
    expect(h.read.mock.calls.at(-1)?.[2]?.historyId).not.toBe(lostHistoryId);
  });

  it('shows the read failure first, then the unconfirmed change once a read succeeds', async () => {
    const { h, execute } = await afterLostReply(
      (lost) => lost.mockRejectedValueOnce(new TypeError('offline')),
      (read) =>
        read
          .mockRejectedValueOnce(new TypeError('read failed'))
          .mockResolvedValueOnce(serverSnapshot),
    );
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');

    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(h.state().data).toEqual(serverData);
    expect(readPlanningProblem(h.state().planning)).toBe('unconfirmed');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
