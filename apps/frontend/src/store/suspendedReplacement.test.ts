import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/useStore';
import { resetStoreWithCompany } from '@/test/fixtures';
import { runSuspendedReplacement } from './suspendedReplacement';

const original = {
  refreshPlanning: useStore.getState().refreshPlanning,
  planningReadyForReplacement: useStore.getState().planningReadyForReplacement,
  suspendPlanningIntents: useStore.getState().suspendPlanningIntents,
};

const probe = { ready: true, suspends: 0, releases: 0, refreshed: true };
const refreshPlanning = vi.fn(async () => probe.refreshed);

beforeEach(async () => {
  await resetStoreWithCompany();
  Object.assign(probe, { ready: true, suspends: 0, releases: 0, refreshed: true });
  refreshPlanning.mockClear();
  useStore.setState({
    refreshPlanning,
    planningReadyForReplacement: () => probe.ready,
    suspendPlanningIntents: () => {
      probe.suspends += 1;
      return () => {
        probe.releases += 1;
      };
    },
  });
});

afterEach(() => {
  useStore.setState(original);
});

describe('runSuspendedReplacement', () => {
  it('sends nothing while planning is not settled', async () => {
    probe.ready = false;
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(runSuspendedReplacement({ send, recovery: 'refresh' })).resolves.toEqual({
      kind: 'blocked',
    });
    expect(send).not.toHaveBeenCalled();
    expect(probe.suspends).toBe(0);
  });

  it('reports a refusal with the server message and resumes writes for a retry', async () => {
    const outcome = await runSuspendedReplacement({
      send: async () => Response.json({ error: 'Not allowed here.' }, { status: 403 }),
      recovery: 'refresh',
    });
    expect(outcome).toEqual({ kind: 'refused', status: 403, message: 'Not allowed here.' });
    expect(probe.releases).toBe(1);
    expect(refreshPlanning).not.toHaveBeenCalled();
  });

  it('refreshes after a commit and resumes writes', async () => {
    const outcome = await runSuspendedReplacement({
      send: async () => new Response(null, { status: 204 }),
      recovery: 'refresh',
    });
    expect(outcome).toMatchObject({ kind: 'committed', reloadRequired: false });
    expect(refreshPlanning).toHaveBeenCalledWith({ fresh: true });
    expect(probe.releases).toBe(1);
  });

  it('keeps writes suspended when the read after a commit fails', async () => {
    probe.refreshed = false;
    const outcome = await runSuspendedReplacement({
      send: async () => new Response(null, { status: 204 }),
      recovery: 'refresh',
    });
    expect(outcome).toMatchObject({ kind: 'committed', reloadRequired: true });
    expect(probe.releases).toBe(0);
  });

  it('skips the fresh read when the committed response reports no change', async () => {
    const outcome = await runSuspendedReplacement({
      send: async () => Response.json({ changed: false }),
      recovery: 'refresh',
      isChanged: async (response) => {
        const body = (await response.clone().json()) as { changed: boolean };
        return body.changed;
      },
    });
    expect(outcome).toMatchObject({ kind: 'committed', reloadRequired: false });
    expect(refreshPlanning).not.toHaveBeenCalled();
    expect(probe.releases).toBe(1);
  });

  it.each([408, 502])('reconciles an HTTP %i as uncertain', async (status) => {
    const outcome = await runSuspendedReplacement({
      send: async () => new Response(null, { status }),
      recovery: 'refresh',
    });
    expect(outcome).toEqual({
      kind: 'uncertain',
      failure: { kind: 'status', status, message: undefined },
      reloadRequired: false,
    });
    expect(refreshPlanning).toHaveBeenCalledWith({ fresh: true });
    expect(probe.releases).toBe(1);
  });

  it('requires a reload when a lost response cannot be reconciled', async () => {
    probe.refreshed = false;
    const cause = new TypeError('Failed to fetch');
    const outcome = await runSuspendedReplacement({
      send: async () => {
        throw cause;
      },
      recovery: 'refresh',
    });
    expect(outcome).toEqual({
      kind: 'uncertain',
      failure: { kind: 'no-response', cause },
      reloadRequired: true,
    });
    expect(probe.releases).toBe(0);
  });

  it('treats a rejected read as a failed one', async () => {
    refreshPlanning.mockRejectedValueOnce(new Error('read exploded'));
    const outcome = await runSuspendedReplacement({
      send: async () => new Response(null, { status: 204 }),
      recovery: 'refresh',
    });
    expect(outcome).toMatchObject({ kind: 'committed', reloadRequired: true });
  });

  it('reports a departure when the company changes during the request', async () => {
    const outcome = await runSuspendedReplacement({
      send: async () => {
        useStore.setState({ activeCompanyId: 'acct-other' });
        return new Response(null, { status: 503 });
      },
      recovery: 'refresh',
    });
    expect(outcome).toEqual({ kind: 'departed' });
  });

  it('holds writes for a page reload under reload recovery', async () => {
    const committed = await runSuspendedReplacement({
      send: async () => new Response(null, { status: 204 }),
      recovery: 'reload',
    });
    expect(committed).toMatchObject({ kind: 'committed', reloadRequired: true });
    const uncertain = await runSuspendedReplacement({
      send: async () => new Response(null, { status: 500 }),
      recovery: 'reload',
    });
    expect(uncertain).toMatchObject({ kind: 'uncertain', reloadRequired: true });
    expect(refreshPlanning).not.toHaveBeenCalled();
    expect(probe.releases).toBe(0);
  });
});
