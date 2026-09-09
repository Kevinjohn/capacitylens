import type { StoreApi } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import { assertDateRange, assertResourceExists, remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import { clampHoursPerDay } from "@capacitylens/shared/types/entities";
import type { Allocation, AppData, Entity, ID, ScopedEntityKey, TimeOff } from "@capacitylens/shared/types/entities";
import {
  clearEntityLenses,
  type Draft,
  type ImportSummary,
  type Patch,
  type ScopedRow,
  type StoreState,
} from "./types";
import { stamp, touch, touchAfter } from "./revisions";
import { HISTORY_LIMIT } from "./history";
import { resetSchedulerView } from "./storeConstants";
import { createGuards } from "./storeGuards";

interface UpdateOwnedInput<K extends ScopedEntityKey> {
  key: K;
  id: ID;
  patch: Patch<ScopedRow<K>>;
  prepare?: ((merged: ScopedRow<K>, existing: ScopedRow<K>) => Patch<ScopedRow<K>>) | undefined;
  cascade?: ((data: AppData, merged: ScopedRow<K>, existing: ScopedRow<K>) => AppData) | undefined;
}

export * from "./revisions";
export * from "./history";
export * from "./storeConstants";

function createMutationActions(set: StoreApi<StoreState>["setState"]) {
  // Every data mutation goes through mutate(): it snapshots the previous data
  // onto the undo stack and clears the redo stack.
  //
  // DO NOT wrap mutate(), its producers, undo/redo, the assert* helpers, or importData in a
  // try/catch to "be safe". Their integrity throws are the store's whole point — the last line that
  // stops bad multi-tenant data being persisted. Swallowing here would convert a loud, fixable
  // rejection into SILENT data corruption (the explicit anti-goal; see DEFENSIVE-CODING.md §4). If
  // a producer throws, `set` never runs, so state is left untouched — a clean, atomic failure.
  const mutate = (producer: (data: AppData) => AppData) =>
    set((state) => ({
      data: producer(state.data),
      past: [...state.past, state.data].slice(-HISTORY_LIMIT),
      future: [],
    }));

  // Erasure/purge actions must not leave a recoverable pre-erasure snapshot in memory. They also
  // cannot honestly be undoable, so clear both history directions as part of the same state write.
  const mutateIrreversible = (producer: (data: AppData) => AppData) =>
    set((state) => ({ data: producer(state.data), past: [], future: [] }));

  return { mutate, mutateIrreversible };
}

const applyPatch = <T extends Entity>(row: T, patch: Patch<T>): T => {
  const next = { ...row, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (next as Record<string, unknown>)[key];
  }
  return next;
};

const updateById = <T extends Entity>(list: T[], id: ID, patch: Patch<T>): T[] =>
  list.map((row) => (row.id === id ? { ...applyPatch(row, patch), updatedAt: touchAfter(row.updatedAt) } : row));

function createGuardedActions(blockedByViewer: ReturnType<typeof createGuards>["blockedByViewer"]) {
  const createGuardedAction =
    <A extends unknown[], R>(action: (...parameters: A) => R, blockedValue?: R) =>
    (...parameters: A): R =>
      blockedByViewer() ? (blockedValue as R) : action(...parameters);
  const createGuardedAddAction =
    <A extends unknown[], E>(build: (...parameters: A) => E, persist: (built: E, ...args: A) => E) =>
    (...parameters: A): E => {
      const built = build(...parameters);
      return blockedByViewer() ? built : persist(built, ...parameters);
    };
  return { createGuardedAction, createGuardedAddAction };
}

interface OwnedUpdateDependencies {
  get: StoreApi<StoreState>["getState"];
  resolveOwnedRow: ReturnType<typeof createGuards>["resolveOwnedRow"];
  mutate: (producer: (data: AppData) => AppData) => void;
}

function createOwnedUpdater({ get, resolveOwnedRow, mutate }: OwnedUpdateDependencies) {
  return <K extends ScopedEntityKey>({ key, id, patch, prepare, cascade }: UpdateOwnedInput<K>): boolean => {
    const existing = resolveOwnedRow(get().data, key, id);
    if (!existing) return false;
    const effective = prepare ? prepare(applyPatch(existing, patch), existing) : patch;
    mutate((data) => {
      const rows = updateById(data[key] as Entity[], id, effective as Partial<Entity>);
      const next = { ...data, [key]: rows };
      return cascade ? cascade(next, applyPatch(existing, effective), existing) : next;
    });
    return true;
  };
}

interface AllocationCreationDependencies {
  get: StoreApi<StoreState>["getState"];
  requireAccount: ReturnType<typeof createGuards>["requireAccount"];
  blockedByViewer: ReturnType<typeof createGuards>["blockedByViewer"];
  assertAllocation: ReturnType<typeof createGuards>["assertAllocation"];
  mutate: (producer: (data: AppData) => AppData) => void;
}

interface TimeOffCreationDependencies {
  get: StoreApi<StoreState>["getState"];
  requireAccount: ReturnType<typeof createGuards>["requireAccount"];
  blockedByViewer: ReturnType<typeof createGuards>["blockedByViewer"];
  assertResourceExists: typeof assertResourceExists;
  mutate: (producer: (data: AppData) => AppData) => void;
}

function createAllocationCreator(dependencies: AllocationCreationDependencies) {
  return (inputs: readonly Draft<Allocation>[]): Allocation[] => {
    if (inputs.length === 0) throw new Error("At least one allocation is required.");
    const accountId = dependencies.requireAccount();
    const allocations = inputs.map((input) => ({
      ...input,
      hoursPerDay: clampHoursPerDay(input.hoursPerDay),
      id: newId(),
      accountId,
      ...stamp(),
    }));
    if (dependencies.blockedByViewer()) return allocations;
    const data = dependencies.get().data;
    for (const allocation of allocations) {
      dependencies.assertAllocation(
        data,
        accountId,
        allocation.resourceId,
        allocation.activityId,
        allocation.hoursPerDay,
        allocation.projectId,
      );
      assertDateRange(allocation.startDate, allocation.endDate);
    }
    dependencies.mutate((current) => ({ ...current, allocations: [...current.allocations, ...allocations] }));
    return allocations;
  };
}

function createTimeOffCreator(dependencies: TimeOffCreationDependencies) {
  return (inputs: readonly Draft<TimeOff>[]): TimeOff[] => {
    if (inputs.length === 0) throw new Error("At least one time off entry is required.");
    const accountId = dependencies.requireAccount();
    const timeOffs = inputs.map((input) => ({
      ...input,
      id: newId(),
      accountId,
      ...stamp(),
    }));
    if (dependencies.blockedByViewer()) return timeOffs;
    const data = dependencies.get().data;
    for (const timeOff of timeOffs) {
      dependencies.assertResourceExists(data, accountId, timeOff.resourceId);
      assertDateRange(timeOff.startDate, timeOff.endDate);
    }
    dependencies.mutate((current) => ({ ...current, timeOff: [...current.timeOff, ...timeOffs] }));
    return timeOffs;
  };
}

function createImportAction(
  set: StoreApi<StoreState>["setState"],
  get: StoreApi<StoreState>["getState"],
  createGuardedAction: ReturnType<typeof createGuardedActions>["createGuardedAction"],
) {
  return createGuardedAction(
    (accountId: ID, incoming: AppData): ImportSummary => {
      const result = remapAndValidateImport(get().data, accountId, incoming, touch());
      if (result.imported === 0) return { imported: 0, skipped: result.skipped };
      set((state) => ({
        data: result.data,
        past: [...state.past, state.data].slice(-HISTORY_LIMIT),
        future: [],
        ui: { ...resetSchedulerView(state.ui), filters: clearEntityLenses(state.ui.filters) },
      }));
      return { imported: result.imported, skipped: result.skipped };
    },
    { imported: 0, skipped: 0 },
  );
}

export function createStoreInternals(set: StoreApi<StoreState>["setState"], get: StoreApi<StoreState>["getState"]) {
  const { mutate, mutateIrreversible } = createMutationActions(set);

  const {
    requireAccount,
    blockedByViewer,
    resolveOwnedRow,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    assertHalfDays,
    snapColor,
    applySnappedColor,
  } = createGuards(get, set);

  const { createGuardedAction, createGuardedAddAction } = createGuardedActions(blockedByViewer);
  const updateOwned = createOwnedUpdater({ get, resolveOwnedRow, mutate });
  const createAllocations = createAllocationCreator({ get, requireAccount, blockedByViewer, assertAllocation, mutate });
  const createTimeOffs = createTimeOffCreator({ get, requireAccount, blockedByViewer, assertResourceExists, mutate });
  const importSlice = createImportAction(set, get, createGuardedAction);

  // clampHoursPerDay (allocations, [0,24]) and clampWorkingHoursPerDay (resources, (0,24])
  // come from the shared core (entities.ts) so the store write boundary and the import
  // sanitiser apply the IDENTICAL clamp — no per-path drift.

  return {
    mutate,
    mutateIrreversible,
    applyPatch,
    updateById,
    requireAccount,
    blockedByViewer,
    resolveOwnedRow,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    assertHalfDays,
    snapColor,
    applySnappedColor,
    createGuardedAction,
    createGuardedAddAction,
    updateOwned,
    createAllocations,
    createTimeOffs,
    importSlice,
  };
}

export type StoreInternals = ReturnType<typeof createStoreInternals>;
