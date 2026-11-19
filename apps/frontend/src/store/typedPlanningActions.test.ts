import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore';
import { makeClient, makeResourceDraft, resetStoreWithCompany } from '@/test/fixtures';
import { requireCreated } from '@/test/requireCreated';
import { PlanningControllerError } from '@/data/planning/planningErrors';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';

beforeEach(async () => {
  await resetStoreWithCompany();
});

function refuseNextPlanningMutation(): void {
  getStubPlanningTransport().failNext(
    new PlanningControllerError('The server refused the planning change.', 'VALIDATION_ERROR', 400),
  );
}

describe('typed planning domain rejections', () => {
  it('passes the shared company guard when the company is known only from the summaries', async () => {
    const { activeCompanyId, data } = useStore.getState();
    if (!activeCompanyId) throw new Error('Expected an active account.');
    useStore.setState({
      data: { ...data, accounts: [] },
      companySummaries: [{ id: activeCompanyId, name: 'Daily Planet', role: 'owner' }],
    });
    const sent = getStubPlanningTransport().calls.length;
    // The guard admits a company whose slice is still loading; no command can be built until the
    // company row is published, so the write is refused as no company selected and nothing is sent.
    await expect(
      useStore.getState().addClient({ name: 'Wayne Enterprises', color: '#2d75da' }),
    ).rejects.toThrow('No active company is selected.');
    expect(getStubPlanningTransport().calls).toHaveLength(sent);
  });

  it('refuses a foreign row while treating an absent id as stale', async () => {
    const foreign = makeClient({ id: 'foreign-client', companyId: 'a2' });
    useStore.setState((state) => ({
      data: { ...state.data, clients: [...state.data.clients, foreign] },
    }));
    await expect(
      useStore.getState().updateClient(foreign.id, { name: 'Changed' }),
    ).rejects.toMatchObject({
      code: 'record_wrong_account',
    });
    await expect(
      useStore.getState().updateClient('missing', { name: 'Changed' }),
    ).resolves.toBeUndefined();
    expect(useStore.getState().data.clients.find((row) => row.id === foreign.id)).toBe(foreign);
  });

  it("sends an edit form's row timestamp with the update", async () => {
    const created = await useStore
      .getState()
      .addClient({ name: 'Wayne Enterprises', color: '#2d75da' });
    const row = requireCreated(created);
    const write = useStore
      .getState()
      .updateClient(row.id, { name: 'Queen Industries' }, row.updatedAt);
    // The transport is bound when the store is built, so the pending execution is what it is sent.
    expect(useStore.getState().planning.phase).toMatchObject({ kind: 'writing' });
    const { phase } = useStore.getState().planning;
    expect(phase.kind === 'writing' && phase.write.execution).toMatchObject({
      intent: { operation: 'catalogue.update', entity: { entity: 'clients', id: row.id } },
      expectedUpdatedAt: row.updatedAt,
    });
    await write;
  });

  it('rejects an empty company working week before normalization', async () => {
    const company = useStore.getState().data.accounts[0];
    if (!company) throw new Error('Expected account fixture.');
    await expect(
      useStore.getState().updateCompany(company.id, { workingDays: [] }),
    ).rejects.toThrow(/at least one working day/i);
    expect(useStore.getState().data.accounts[0]?.workingDays).toEqual(company.workingDays);
  });

  it('restores the previous working week when the latest settings change is undone', async () => {
    const company = useStore.getState().data.accounts[0];
    if (!company) throw new Error('Expected account fixture.');
    await useStore.getState().updateCompany(company.id, { workingDays: [1, 3, 5] });
    expect(
      useStore.getState().data.accounts.find((row) => row.id === company.id)?.workingDays,
    ).toEqual([1, 3, 5]);
    await useStore.getState().updateCompany(company.id, { workingDays: [2, 4] });
    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
    expect(
      useStore.getState().data.accounts.find((row) => row.id === company.id)?.workingDays,
    ).toEqual([1, 3, 5]);
  });

  it('surfaces a server refusal for project attribution on an internal activity', async () => {
    refuseNextPlanningMutation();
    await expect(
      useStore
        .getState()
        .addActivity({ name: 'Operations', kind: 'internal', projectId: 'project-not-allowed' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'catalogue.create',
      entity: {
        entity: 'activities',
        fields: { name: 'Operations', kind: 'internal', projectId: 'project-not-allowed' },
      },
    });
    expect(useStore.getState().data.activities).toHaveLength(0);
  });

  it('surfaces server refusals for placeholder fields and preserves the prior row', async () => {
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Wayne Enterprises', color: '#2d75da' }),
    );
    const project = await requireCreated(
      useStore.getState().addProject({ name: 'Batcave', clientId: client.id, color: '#2d75da' }),
    );
    const draft = makeResourceDraft({ kind: 'placeholder', projectId: project.id });
    refuseNextPlanningMutation();
    await expect(
      useStore.getState().addResource({ ...draft, engagement: 'supplementary' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'resource.create',
      fields: { kind: 'placeholder', engagement: 'supplementary' },
    });
    const placeholder = await requireCreated(useStore.getState().addResource(draft));
    const historyBefore = useStore.getState().planning.history;
    refuseNextPlanningMutation();
    await expect(
      useStore.getState().updateResource(placeholder.id, { engagement: 'supplementary' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'resource.update',
      id: placeholder.id,
      changes: { engagement: 'supplementary' },
    });
    refuseNextPlanningMutation();
    await expect(
      useStore.getState().updateResource(placeholder.id, { workingDays: [0, 6], halfDays: [6] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(useStore.getState().planning.history).toEqual(historyBefore);
    expect(
      useStore.getState().data.resources.find((row) => row.id === placeholder.id),
    ).toMatchObject({
      engagement: 'studio',
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [],
    });
  });

  it('keeps the dangling time-off resource reason before a command is sent', async () => {
    await expect(
      useStore.getState().addTimeOff({
        resourceId: 'missing-resource',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        type: 'holiday',
      }),
    ).rejects.toMatchObject({ code: 'time_off_resource_invalid' });
    expect(useStore.getState().data.timeOff).toHaveLength(0);
  });

  it('surfaces a server refusal for a blank closure name', async () => {
    refuseNextPlanningMutation();
    await expect(
      useStore
        .getState()
        .addClosure({ name: '  ', startDate: '2026-12-24', endDate: '2026-12-25' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'closure.create',
      fields: { name: '  ', startDate: '2026-12-24', endDate: '2026-12-25' },
    });
    expect(useStore.getState().data.closures).toHaveLength(0);
  });
});
