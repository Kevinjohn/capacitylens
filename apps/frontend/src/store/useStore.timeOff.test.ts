import { requireCreated } from '@/test/requireCreated';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Draft } from './useStore';
import type { Resource, TimeOff } from '@capacitylens/shared/types/entities';
import {
  DEFAULT_COMPANY_ID,
  makeResource,
  makeResourceDraft,
  resetStoreWithCompany,
  setPlanningAuthority,
} from '@/test/fixtures';
import { useStore } from './useStore';
import { PlanningCacheError } from '@/data/planning/planningErrors';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { queueTimeOffRepeatResponse } from '@/test/planning/queuePlanningTestKit';

const state = () => useStore.getState();

beforeEach(async () => resetStoreWithCompany());

async function timeOffSetup() {
  const resource = await requireCreated(state().addResource(makeResourceDraft()));
  const draft = (overrides: Partial<Draft<TimeOff>> = {}): Draft<TimeOff> => ({
    resourceId: resource.id,
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    type: 'holiday',
    ...overrides,
  });
  return { resource, draft };
}

/** A weekly repeat whose last start is `until`. */
const weekly = (until: string) => ({
  pattern: { kind: 'weeks' as const, interval: 1 as const },
  until,
});

describe('atomic time-off creation: happy path', () => {
  it('sends the first entry and the pattern, then returns every entry with unique ids, account stamps, and the copied note', async () => {
    const { draft } = await timeOffSetup();
    const publishedBatchSizes: number[] = [];
    let data = state().data;
    const unsubscribe = useStore.subscribe(() => {
      if (state().data !== data) {
        publishedBatchSizes.push(state().data.timeOff.length);
        data = state().data;
      }
    });

    queueTimeOffRepeatResponse();
    const created = await requireCreated(
      state().addRepeatedTimeOff(draft({ note: 'Family trip' }), weekly('2026-06-08'), 2),
    );
    unsubscribe();

    const sent = getStubPlanningTransport().calls.at(-1);
    expect(sent).toMatchObject({
      operation: 'timeOff.repeat',
      timeOff: { id: created[0]?.id, startDate: '2026-06-01', endDate: '2026-06-02' },
      repeat: weekly('2026-06-08'),
      occurrenceIds: [created[1]?.id],
    });
    expect(sent).not.toHaveProperty('entries');

    expect(publishedBatchSizes.length).toBeGreaterThan(0);
    expect(publishedBatchSizes.every((size) => size === 2)).toBe(true);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((timeOff) => timeOff.id)).size).toBe(2);
    expect(created.every((timeOff) => timeOff.companyId === DEFAULT_COMPANY_ID)).toBe(true);
    expect(created.map((timeOff) => [timeOff.startDate, timeOff.endDate])).toEqual([
      ['2026-06-01', '2026-06-02'],
      ['2026-06-08', '2026-06-09'],
    ]);
    expect(created.map((timeOff) => timeOff.note)).toEqual(['Family trip', 'Family trip']);
    expect(created.every((timeOff) => !Object.hasOwn(timeOff, 'seriesId'))).toBe(true);
    expect(state().data.timeOff).toEqual(created);
    expect(state().planning.history.canUndo).toBe(true);
  });
});

describe('atomic time-off creation: atomic validation', () => {
  it('rejects a repeat of fewer than two entries locally and preserves the server refusal', async () => {
    const { draft } = await timeOffSetup();

    await expect(
      requireCreated(state().addRepeatedTimeOff(draft(), weekly('2026-06-08'), 1)),
    ).rejects.toThrow(/at least two entries/i);
    expect(state().data.timeOff).toHaveLength(0);

    let dataPublications = 0;
    let data = state().data;
    const unsubscribe = useStore.subscribe(() => {
      if (state().data !== data) {
        dataPublications += 1;
        data = state().data;
      }
    });
    getStubPlanningTransport().failNext(
      new PlanningCacheError('The server refused the time-off batch.', 'VALIDATION_ERROR', 400),
    );
    await expect(
      requireCreated(state().addRepeatedTimeOff(draft(), weekly('2026-06-15'), 3)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    unsubscribe();

    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'timeOff.repeat',
      timeOff: { startDate: '2026-06-01', endDate: '2026-06-02' },
      repeat: weekly('2026-06-15'),
      occurrenceIds: [expect.any(String), expect.any(String)],
    });
    expect(dataPublications).toBe(0);
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().planning.history.canUndo).toBe(true);
  });
});

describe('atomic time-off creation: resource validation', () => {
  it('rejects dangling, cross-account, and external resources before publication', async () => {
    const { draft, resource } = await timeOffSetup();
    const foreignResource: Resource = makeResource({
      id: 'foreign-resource',
      companyId: 'foreign-account',
    });
    useStore.setState({
      data: { ...state().data, resources: [...state().data.resources, foreignResource] },
    });

    await expect(
      requireCreated(
        state().addRepeatedTimeOff(
          draft({ resourceId: 'missing-resource' }),
          weekly('2026-06-08'),
          2,
        ),
      ),
    ).rejects.toThrow(/existing resource in this company/i);
    await expect(
      requireCreated(
        state().addRepeatedTimeOff(
          draft({ resourceId: foreignResource.id }),
          weekly('2026-06-08'),
          2,
        ),
      ),
    ).rejects.toThrow(/existing resource in this company/i);

    const external = await requireCreated(
      state().addResource({ ...makeResourceDraft(), kind: 'external', name: 'Partner' }),
    );
    await expect(
      requireCreated(
        state().addRepeatedTimeOff(draft({ resourceId: external.id }), weekly('2026-06-08'), 2),
      ),
    ).rejects.toThrow(/external.*3rd-party/i);

    expect(state().data.timeOff).toHaveLength(0);
    expect(state().data.resources.map(({ id }) => id)).toContain(resource.id);
  });
});

describe('atomic time-off creation: history', () => {
  it('uses one undo/redo step for the complete batch and keeps addTimeOff working', async () => {
    const { draft } = await timeOffSetup();
    queueTimeOffRepeatResponse();
    const created = await requireCreated(
      state().addRepeatedTimeOff(draft(), weekly('2026-06-15'), 3),
    );
    expect(state().planning.history).toEqual({ canUndo: true, canRedo: false });

    await expect(state().undoPlanning()).resolves.toBe(true);
    expect(getStubPlanningTransport().historySteps).toEqual(['undo']);
    expect(state().data.timeOff).toHaveLength(0);
    await expect(state().redoPlanning()).resolves.toBe(true);
    expect(getStubPlanningTransport().historySteps).toEqual(['undo', 'redo']);
    const redone = state().data.timeOff;
    expect(redone.map((timeOff) => ({ ...timeOff, updatedAt: null }))).toEqual(
      created.map((timeOff) => ({ ...timeOff, updatedAt: null })),
    );
    const single = await requireCreated(
      state().addTimeOff(draft({ startDate: '2026-06-15', endDate: '2026-06-15' })),
    );
    expect(state().data.timeOff.at(-1)).toEqual(single);
    expect(state().planning.history).toEqual({ canUndo: true, canRedo: false });
  });
});

describe('atomic time-off creation: viewer guard', () => {
  it('applies the Viewer guard to the whole batch without data or history mutation', async () => {
    const { draft } = await timeOffSetup();
    const historyBefore = state().planning.history;
    setPlanningAuthority({ role: 'viewer', canWrite: false });
    const returned = await state().addRepeatedTimeOff(draft(), weekly('2026-06-08'), 2);

    expect(returned).toEqual({ kind: 'blocked' });
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().planning.history).toBe(historyBefore);
    expect(state().notice).toMatchObject({ tone: 'error' });
  });
});
