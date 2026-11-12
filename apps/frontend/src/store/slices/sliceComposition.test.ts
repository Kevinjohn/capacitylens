import { describe, expect, it } from 'vitest';
import { createTestPlanningTransport } from '@/test/createTestPlanningTransport';
import { createAccountSlice } from './accountSlice';
import { createAllocationSlice } from './allocationSlice';
import { createRuntimeSlice } from './runtimeSlice';
import { createSchedulerSlice } from './schedulerSlice';
import { createStoreInternals } from '@/store/storeInternal';
import { buildEmptyFilters, useStore } from '@/store/useStore';
import { createTypedPlanningActions } from '@/store/typedPlanningActions';

describe('store slice composition', () => {
  it('owns every store key exactly once', () => {
    const set = useStore.setState;
    const get = useStore.getState;
    const internals = createStoreInternals(get);
    const slices = [
      createAccountSlice()(set, get, useStore),
      createRuntimeSlice(set, get, useStore),
      createSchedulerSlice(buildEmptyFilters)(set, get, useStore),
      createAllocationSlice(internals, createTestPlanningTransport())(set, get, useStore),
      createTypedPlanningActions(get, internals.blockedByViewer),
    ];

    const keySets = slices.map((slice) => new Set(Object.keys(slice)));
    for (const [left, leftKeys] of keySets.entries()) {
      for (const rightKeys of keySets.slice(left + 1)) {
        expect([...leftKeys].filter((key) => rightKeys.has(key))).toEqual([]);
      }
    }

    const composedKeys = [...new Set(slices.flatMap((slice) => Object.keys(slice)))].sort();
    expect(composedKeys).toEqual(Object.keys(useStore.getState()).sort());
  });

  it('keeps every StoreState action in the composed store', () => {
    const actionNames = Object.entries(useStore.getState())
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);

    expect(actionNames).toEqual(
      expect.arrayContaining([
        'updateAccount',
        'setActiveAccount',
        'beginAccountSummariesRequest',
        'setAccountSummaries',
        'setHydrated',
        'setPersistError',
        'setLoadError',
        'setConnectionError',
        'setNotice',
        'announceCapacity',
        'setDirtyForm',
        'setDirtyFormSource',
        'setDraggingAllocation',
        'setTheme',
        'setUtilizationPref',
        'setBarLabelPref',
        'setSidebarOpen',
        'setMinimiseWeekends',
        'setActiveRole',
        'invalidateMemberships',
        'setMasquerade',
        'addDiscipline',
        'updateDiscipline',
        'deleteDiscipline',
        'addResource',
        'updateResource',
        'addClient',
        'updateClient',
        'addProject',
        'updateProject',
        'addPhase',
        'updatePhase',
        'deletePhase',
        'addActivity',
        'updateActivity',
        'deleteActivity',
        'addAllocation',
        'addAllocations',
        'updateAllocation',
        'deleteAllocation',
        'deleteAllocationSeriesFrom',
        'addTimeOff',
        'addTimeOffs',
        'updateTimeOff',
        'deleteTimeOff',
        'addClosure',
        'updateClosure',
        'deleteClosure',
        'setZoom',
        'setOriginDate',
        'panDays',
        'goToToday',
        'goToDate',
        'setDrawMode',
        'selectAllocation',
        'setFilters',
        'clearFilters',
        'toggleGroup',
        'jumpToResource',
        'consumeResourceJump',
      ]),
    );
  });
});
