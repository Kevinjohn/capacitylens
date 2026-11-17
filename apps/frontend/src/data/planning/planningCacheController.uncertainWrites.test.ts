import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import { readPlanningProblem } from './planningNotices';
import {
  context,
  intent,
  inverse,
  canonicalData,
  success,
  harness,
} from './planningCacheController.testSupport';

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
const serverSnapshot: PlanningSnapshot = { revision: 3, canWrite: true, data: serverData };

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
  await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
  await h.controller.execute(h.controller.begin(), intent, inverse);
  expect(h.state().planning.history.past).toHaveLength(1);
  lose(execute);
  nextReads(read);
  const readsBefore = read.mock.calls.length;
  await expect(h.controller.execute(h.controller.begin(), intent, inverse)).rejects.toMatchObject({
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
        status: 'ready',
        revision: 3,
        pending: null,
        error: null,
        outcome: { kind: 'unconfirmed', mutationId: 'mutation-2' },
        history: { past: [], future: [] },
      });
      expect(readPlanningProblem(h.state().planning)).toBe('unconfirmed');

      execute.mockImplementationOnce(async (_context, execution) =>
        success(execution.mutationId, 4),
      );
      await h.controller.execute(h.controller.begin(), intent, inverse);
      expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 4 });
      expect(readPlanningProblem(h.state().planning)).toBeNull();
      expect(execute).toHaveBeenCalledTimes(3);
    },
  );

  it('clears undo history even when the server has not yet committed the change', async () => {
    const { h } = await afterLostReply(
      (execute) => execute.mockRejectedValueOnce({ status: 408 }),
      (read) => read.mockResolvedValueOnce({ revision: 2, canWrite: true, data: canonicalData() }),
    );
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      revision: 2,
      outcome: { kind: 'unconfirmed', mutationId: 'mutation-2' },
      history: { past: [], future: [] },
    });
  });

  it('shows the read failure first, then the unconfirmed change once a read succeeds', async () => {
    const { h, execute } = await afterLostReply(
      (lost) => lost.mockRejectedValueOnce(new TypeError('offline')),
      (read) =>
        read
          .mockRejectedValueOnce(new TypeError('read failed'))
          .mockResolvedValueOnce(serverSnapshot),
    );
    expect(h.state().planning.status).toBe('error');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');

    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.status).toBe('ready');
    expect(h.state().data).toEqual(serverData);
    expect(readPlanningProblem(h.state().planning)).toBe('unconfirmed');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
