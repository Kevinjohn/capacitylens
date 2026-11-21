import { describe, expect, it, vi } from 'vitest';
import { createTuyau } from '@tuyau/core/client';
import { registry } from '@capacitylens/backend/registry';
import type { PlanningIntent } from '@/api/planningContracts';
import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import { createPlanningTransport } from './planningTransport';
import { setMasqueradeToken } from '@/api/masqueradeToken';

const context = {
  identity: 'bruce-user',
  companyId: 'wayne',
  masqueradeToken: 'captured-context',
};
const signal = new AbortController().signal;
const id = '7415a19e-539d-45c9-9c52-8b8c3a058926';
const mutationId = '7b2e020c-f2b4-4a0f-b6b2-17148ddac4a1';
const execution = (intent: PlanningIntent) => ({ mutationId, baseRevision: 5, intent });

function harness(body: unknown, status = 200) {
  const requests: Request[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(body, { status });
  });
  const client = createTuyau({
    baseUrl: 'http://planning.test',
    registry,
    credentials: 'include',
    retry: 0,
    timeout: false,
    fetch: fetcher,
  });
  return { transport: createPlanningTransport(client), requests, fetcher };
}

const createFields = {
  clients: { name: 'Wayne Enterprises', color: '#76a5e7' },
  projects: { name: 'Gotham Renewal', color: '#76a5e7', clientId: 'client-1' },
  activities: { name: 'City planning', kind: 'internal' as const, projectId: null, phaseId: null },
  phases: { name: 'Gotham launch', projectId: 'project-1' },
  disciplines: { name: 'Design', color: null, sortOrder: 0 },
};
const allocation = {
  id,
  resourceId: 'resource-1',
  activityId: 'activity-1',
  startDate: '2026-10-26',
  endDate: '2026-10-30',
  hoursPerDay: 8,
  status: 'confirmed' as const,
};
const occurrence = { id, startDate: '2026-11-02', endDate: '2026-11-06' };
const timeOff = {
  id,
  resourceId: 'resource-1',
  startDate: '2026-10-26',
  endDate: '2026-10-30',
  type: 'holiday' as const,
};
const resource = {
  kind: 'person' as const,
  name: 'Bruce Wayne',
  role: 'Planner',
  avatarUrl: null,
  disciplineId: null,
  employmentType: 'permanent' as const,
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as Array<1 | 2 | 3 | 4 | 5>,
  halfDays: [],
  projectId: null,
  color: '#76a5e7',
  isFavourite: false,
  firstAvailableDate: null,
  lastAvailableDate: null,
};
type Restoration = { consumedGroupId: string | null; replacementGroupId: string | null };
const noRestoration: Restoration = { consumedGroupId: null, replacementGroupId: null };
const groupId = '5d0c3f8e-8a54-4b7e-9f0a-3c2e1b6d7a90';
const cases: Array<{ intent: PlanningIntent; restoration?: Restoration }> = [
  { intent: { operation: 'allocation.create', allocation } },
  {
    intent: {
      operation: 'allocation.createGroup',
      allocation,
      repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-02' },
    },
  },
  {
    intent: { operation: 'allocation.update', id, changes: { hoursPerDay: 4 } },
  },
  {
    intent: { operation: 'allocation.duplicate', sourceAllocationId: 'source-1', occurrence },
  },
  {
    intent: { operation: 'allocation.delete', id },
    restoration: { consumedGroupId: null, replacementGroupId: groupId },
  },
  {
    intent: { operation: 'allocation.deleteGroup', ids: [id] },
    restoration: { consumedGroupId: null, replacementGroupId: groupId },
  },
  {
    intent: { operation: 'resource.create', id, fields: resource },
  },
  {
    intent: { operation: 'resource.update', id, changes: { role: 'Designer' } },
  },
  { intent: { operation: 'timeOff.create', timeOff } },
  {
    intent: { operation: 'timeOff.update', id, changes: { type: 'sick' } },
  },
  {
    intent: {
      operation: 'timeOff.repeat',
      timeOff,
      repeat: { pattern: { kind: 'monthly-date' }, until: '2026-12-02' },
      occurrenceIds: ['occurrence-2'],
    },
  },
  {
    intent: { operation: 'timeOff.delete', id },
    restoration: { consumedGroupId: null, replacementGroupId: groupId },
  },
  {
    intent: { operation: 'timeOff.deleteGroup', ids: [id] },
    restoration: { consumedGroupId: null, replacementGroupId: groupId },
  },
  {
    intent: {
      operation: 'closure.create',
      id,
      fields: { name: 'Wayne anniversary', startDate: '2026-12-25', endDate: '2026-12-25' },
    },
  },
  {
    intent: { operation: 'closure.update', id, changes: { name: 'Wayne holiday' } },
  },
  {
    intent: { operation: 'closure.delete', id },
    restoration: { consumedGroupId: null, replacementGroupId: groupId },
  },
  {
    intent: { operation: 'settings.update', changes: { timezone: 'Europe/London' } },
  },
];
for (const entity of ['clients', 'projects', 'activities', 'phases', 'disciplines'] as const) {
  // Each catalogue member remains a correlated entity/field pair from the finite contract.
  const create = {
    operation: 'catalogue.create',
    entity: { entity, id, fields: createFields[entity] },
  } as PlanningIntent;
  cases.push({ intent: create });
  cases.push({
    intent: {
      operation: 'catalogue.update',
      entity: { entity, id, changes: { name: 'Gotham update' } },
    },
  });
}
for (const entity of ['phases', 'disciplines'] as const) {
  cases.push({
    intent: { operation: 'catalogue.delete', entity: { entity, id } },
    restoration: { consumedGroupId: null, replacementGroupId: groupId },
  });
}

for (const action of ['archive', 'unarchive'] as const) {
  cases.push({
    intent: { operation: `resource.${action}`, id },
  });
  for (const entity of ['clients', 'projects', 'activities'] as const) {
    cases.push({
      intent: { operation: `catalogue.${action}`, entity: { entity, id } },
    });
  }
}

describe('generated planning transport', () => {
  it.each(cases)(
    'sends $intent.operation to the one mutation route',
    async ({ intent, restoration = noRestoration }) => {
      const receipt = {
        status: 'committed',
        mutationId,
        revision: 6,
        restoration,
      };
      const { transport, requests } = harness(receipt);
      expect(await transport.execute(context, execution(intent), signal)).toEqual(receipt);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://planning.test/api/companies/wayne/planning/mutations');
      expect(requests[0]?.method).toBe('POST');
      expect(requests[0]?.credentials).toBe('include');
      expect(requests[0]?.headers.get('X-Masquerade-Context')).toBe('captured-context');
      expect(await requests[0]?.json()).toEqual(execution(intent));
    },
  );

  it("keeps the action's captured proof when the shared mode changes before fetch dispatch", async () => {
    const { transport, requests } = harness({ status: 'committed', mutationId, revision: 6 });
    const actionContext = {
      identity: 'bruce-user',
      companyId: 'wayne',
      masqueradeToken: 'captured-context',
    };
    setMasqueradeToken('newer-context');

    await transport.execute(
      actionContext,
      execution({ operation: 'allocation.create', allocation }),
      signal,
    );

    expect(requests[0]?.headers.get('X-Masquerade-Context')).toBe('captured-context');
  });

  it('sends an empty proof when the caller captured none, never a newer shared one', async () => {
    const { transport, requests } = harness({
      revision: 1,
      canWrite: true,
      data: createEmptyAppData(),
    });
    setMasqueradeToken('newer-context');

    await transport.read({ identity: 'bruce-user', companyId: 'wayne' }, signal).catch(() => null);

    expect(requests[0]?.headers.get('X-Masquerade-Context')).toBe('');
    setMasqueradeToken(null);
  });

  it('surfaces context changes without replaying a stale write', async () => {
    const { transport, fetcher } = harness(
      { error: 'The masquerade context changed.', code: 'MASQUERADE_CONTEXT_CHANGED' },
      409,
    );

    await expect(
      transport.execute(
        { ...context, masqueradeToken: 'captured-context' },
        execution({ operation: 'allocation.create', allocation }),
        signal,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'MASQUERADE_CONTEXT_CHANGED' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('normalizes a read with the complete canonical authority fingerprint', async () => {
    const authority = {
      actorId: 'bruce',
      effectiveActorId: 'diana',
      role: 'editor',
      canWrite: false,
      canSeePrivateNames: false,
      canSeeTimeOffNote: false,
    };
    const { transport, requests } = harness({
      companyId: 'wayne',
      revision: 5,
      authority,
      data: createEmptyAppData(),
    });
    const result = await transport.read(context, signal);
    expect(result).toEqual({ revision: 5, slice: 'full', data: createEmptyAppData(), authority });
    expect(requests[0]?.url).toBe('http://planning.test/api/companies/wayne/planning');
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.headers.get('X-Masquerade-Context')).toBe('captured-context');
  });

  it('rejects a read whose authority has no role', async () => {
    const { transport } = harness({
      companyId: 'wayne',
      revision: 5,
      authority: {
        actorId: 'bruce',
        effectiveActorId: 'bruce',
        canWrite: true,
        canSeePrivateNames: true,
        canSeeTimeOffNote: true,
      },
      data: createEmptyAppData(),
    });

    await expect(transport.read(context, signal)).rejects.toThrow(
      'The server returned an invalid planning authority.',
    );
  });

  it('asks for the capacity window it is given and returns the server figures', async () => {
    const capacity = {
      window: { from: '2026-05-04', to: '2026-09-28' },
      horizon: { from: '2026-06-03', to: '2026-08-23' },
      resources: {},
    };
    const authority = {
      actorId: 'bruce',
      effectiveActorId: 'bruce',
      role: 'owner',
      canWrite: true,
      canSeePrivateNames: true,
      canSeeTimeOffNote: true,
    };
    const reply = {
      companyId: 'wayne',
      revision: 5,
      authority,
      data: createEmptyAppData(),
      capacity,
    };
    const { transport, requests } = harness(reply);

    const result = await transport.read(context, signal, { window: capacity.window });
    await transport.read(context, signal);

    expect(result.capacity).toEqual(capacity);
    expect(new URL(requests[0]?.url ?? '').search).toBe('?from=2026-05-04&to=2026-09-28');
    expect(new URL(requests[1]?.url ?? '').search).toBe('');
  });

  it("names the page's history on a read and returns the availability the server reports", async () => {
    const historyId = '4c0b5e0e-8f53-4d5b-9a4c-2f7f1e9d6a10';
    const history = { canUndo: true, canRedo: false };
    const { transport, requests } = harness({
      companyId: 'wayne',
      revision: 5,
      authority: {
        actorId: 'bruce',
        effectiveActorId: 'bruce',
        role: 'owner',
        canWrite: true,
        canSeePrivateNames: true,
        canSeeTimeOffNote: true,
      },
      data: createEmptyAppData(),
      history,
    });

    const result = await transport.read(context, signal, { historyId });

    expect(result.history).toEqual(history);
    expect(new URL(requests[0]?.url ?? '').searchParams.get('historyId')).toBe(historyId);
  });

  it('names the revision it holds and returns an unchanged read without rows', async () => {
    const { transport, requests } = harness({
      companyId: 'wayne',
      revision: 5,
      slice: 'unchanged',
      authority: {
        actorId: 'bruce',
        effectiveActorId: 'bruce',
        role: 'owner',
        canWrite: true,
        canSeePrivateNames: true,
        canSeeTimeOffNote: true,
      },
    });

    const result = await transport.read(context, signal, { ifRevision: 5 });

    expect(result).toMatchObject({ revision: 5, slice: 'unchanged' });
    expect(result).not.toHaveProperty('data');
    expect(new URL(requests[0]?.url ?? '').searchParams.get('ifRevision')).toBe('5');
  });

  it.each(['undo', 'redo'] as const)(
    "posts %s with only the step's identity, revision and history id",
    async (kind) => {
      const step = { mutationId, baseRevision: 5, historyId: id };
      const receipt = { status: 'committed', mutationId, revision: 6, restoration: noRestoration };
      const { transport, requests } = harness(receipt);

      expect(await transport[kind](context, step, signal)).toEqual(receipt);

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(`http://planning.test/api/companies/wayne/planning/${kind}`);
      expect(requests[0]?.method).toBe('POST');
      expect(requests[0]?.headers.get('X-Masquerade-Context')).toBe('captured-context');
      expect(await requests[0]?.json()).toEqual(step);
    },
  );

  it('surfaces a refused undo as a planning refusal', async () => {
    const { transport } = harness({ error: 'There is nothing to undo.' }, 409);

    await expect(
      transport.undo(context, { mutationId, baseRevision: 5, historyId: id }, signal),
    ).rejects.toMatchObject({ status: 409, message: 'There is nothing to undo.' });
  });

  it('surfaces a stale proof on a canonical read without replaying it', async () => {
    const { transport, fetcher, requests } = harness(
      { error: 'The masquerade context changed.', code: 'MASQUERADE_CONTEXT_CHANGED' },
      409,
    );

    await expect(transport.read(context, signal)).rejects.toMatchObject({
      status: 409,
      code: 'MASQUERADE_CONTEXT_CHANGED',
    });
    expect(requests[0]?.headers.get('X-Masquerade-Context')).toBe('captured-context');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refuses a canonical read without a verified write capability', async () => {
    const { transport } = harness({
      companyId: 'wayne',
      revision: 5,
      authority: {
        actorId: 'bruce',
        effectiveActorId: 'bruce',
        role: 'owner',
        canSeePrivateNames: true,
        canSeeTimeOffNote: true,
      },
      data: createEmptyAppData(),
    });
    await expect(transport.read(context, signal)).rejects.toThrow();
  });

  it('refuses a read naming another company', async () => {
    const { transport } = harness({
      companyId: 'stark',
      revision: 5,
      authority: {},
      data: createEmptyAppData(),
    });
    await expect(transport.read(context, signal)).rejects.toThrow(/another company/);
  });

  it.each(['read', 'execute'] as const)(
    'preserves flat HTTP loss/refusal semantics for %s',
    async (stage) => {
      const { transport } = harness(
        { error: 'Membership ended', code: 'ACCOUNT_MEMBERSHIP_LOST' },
        403,
      );
      const request =
        stage === 'read'
          ? transport.read(context, signal)
          : transport.execute(
              context,
              execution({ operation: 'allocation.create', allocation }),
              signal,
            );
      await expect(request).rejects.toMatchObject({
        status: 403,
        code: 'ACCOUNT_MEMBERSHIP_LOST',
        message: 'Membership ended',
      });
    },
  );

  it('preserves code-less 401 session loss and does not retry', async () => {
    const { transport, fetcher } = harness({ error: 'Sign in' }, 401);
    await expect(transport.read(context, signal)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('preserves an upstream HTTP 408 without retrying the write', async () => {
    const { transport, fetcher } = harness({ error: 'Request timed out' }, 408);
    await expect(
      transport.execute(context, execution({ operation: 'allocation.create', allocation }), signal),
    ).rejects.toMatchObject({ status: 408, message: 'Request timed out' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('narrows restoration metadata from generated HTTP errors', async () => {
    const { transport } = harness(
      {
        error: 'Confirm restoration',
        code: 'RESTORATION_CONFIRMATION_REQUIRED',
        restorableItemCount: 3,
      },
      409,
    );
    await expect(
      transport.execute(context, execution({ operation: 'allocation.create', allocation }), signal),
    ).rejects.toMatchObject({
      status: 409,
      code: 'RESTORATION_CONFIRMATION_REQUIRED',
      restorableItemCount: 3,
    });
  });
  it('keeps unknown HTTP codes without granting them known product semantics', async () => {
    const { transport } = harness(
      { error: 'New refusal', code: 'FUTURE_CODE', restorableItemCount: '3' },
      403,
    );
    await expect(transport.read(context, signal)).rejects.toMatchObject({
      status: 403,
      code: 'FUTURE_CODE',
      restorableItemCount: undefined,
    });
  });
});
