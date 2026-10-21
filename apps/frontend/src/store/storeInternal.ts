import type { StoreApi } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import { assertDateRange, assertResourceExists, remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import type { AppData, Entity, ID, ScopedEntityKey, TimeOff } from "@capacitylens/shared/types/entities";
import { clearEntityLenses } from "./types";
import type { Draft, ImportSummary, Patch, ScopedRow, StoreState } from "./types";
import { stamp, touch, touchAfter } from "./revisions";
import { HISTORY_LIMIT } from "./history";
import { resetSchedulerView } from "./storeConstants";
import { createGuards } from "./storeGuards";
import type { CreateResult } from "./types";

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
  // Mutations publish only after a producer succeeds, so integrity failures leave state
  // untouched. Let these pure failures reach the caller’s error surface rather than
  // hiding rejected writes. Undo and redo use the same validation boundary.
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
    if (value === undefined) Object.assign(next, { [key]: null });
  }
  return next;
};

const updateById = <T extends Entity>(list: T[], id: ID, patch: Patch<T>): T[] =>
  list.map((row) => (row.id === id ? { ...applyPatch(row, patch), updatedAt: touchAfter(row.updatedAt) } : row));

function createGuardedActions(blockedByViewer: ReturnType<typeof createGuards>["blockedByViewer"]) {
  const createGuardedAction =
    <A extends unknown[]>(action: (...parameters: A) => void) =>
    (...parameters: A): void => {
      if (!blockedByViewer()) action(...parameters);
    };
  // A value-returning action must say what a blocked viewer receives; there is no implicit default.
  const createGuardedValueAction =
    <A extends unknown[], R>(action: (...parameters: A) => R, blockedValue: R) =>
    (...parameters: A): R =>
      blockedByViewer() ? blockedValue : action(...parameters);
  const createGuardedAddAction =
    <A extends unknown[], E>(build: (...parameters: A) => E, persist: (built: E, ...args: A) => E) =>
    (...parameters: A): CreateResult<E> => {
      const built = build(...parameters);
      return blockedByViewer() ? { kind: "blocked" } : { kind: "created", value: persist(built, ...parameters) };
    };
  return { createGuardedAction, createGuardedValueAction, createGuardedAddAction };
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

interface TimeOffCreationDependencies {
  get: StoreApi<StoreState>["getState"];
  requireAccount: ReturnType<typeof createGuards>["requireAccount"];
  blockedByViewer: ReturnType<typeof createGuards>["blockedByViewer"];
  assertResourceExists: typeof assertResourceExists;
  mutate: (producer: (data: AppData) => AppData) => void;
}

function createTimeOffCreator(dependencies: TimeOffCreationDependencies) {
  return (inputs: readonly Draft<TimeOff>[]): CreateResult<TimeOff[]> => {
    if (inputs.length === 0) throw new Error("At least one time off entry is required.");
    const accountId = dependencies.requireAccount();
    const timeOffs = inputs.map((input) => ({
      ...NULLABLE_FIELDS.timeOff,
      ...input,
      id: newId(),
      accountId,
      ...stamp(),
    }));
    if (dependencies.blockedByViewer()) return { kind: "blocked" };
    const data = dependencies.get().data;
    for (const timeOff of timeOffs) {
      dependencies.assertResourceExists(data, accountId, timeOff.resourceId);
      assertDateRange(timeOff.startDate, timeOff.endDate);
    }
    dependencies.mutate((current) => ({ ...current, timeOff: [...current.timeOff, ...timeOffs] }));
    return { kind: "created", value: timeOffs };
  };
}

function createImportAction(
  set: StoreApi<StoreState>["setState"],
  get: StoreApi<StoreState>["getState"],
  createGuardedValueAction: ReturnType<typeof createGuardedActions>["createGuardedValueAction"],
) {
  return createGuardedValueAction(
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

/** Create the shared internal actions used by store slices. */
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
  } = createGuards(get);

  const { createGuardedAction, createGuardedValueAction, createGuardedAddAction } =
    createGuardedActions(blockedByViewer);
  const updateOwned = createOwnedUpdater({ get, resolveOwnedRow, mutate });
  const createTimeOffs = createTimeOffCreator({ get, requireAccount, blockedByViewer, assertResourceExists, mutate });
  const importSlice = createImportAction(set, get, createGuardedValueAction);

  // clampHoursPerDay (allocations, [0,24]) and clampWorkingHoursPerDay (resources, (0,24])
  // come from the shared core (entities.ts) so the store write boundary and the import
  // sanitiser apply the identical clamp. No per-path drift.

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
    createGuardedValueAction,
    createGuardedAddAction,
    updateOwned,
    createTimeOffs,
    importSlice,
  };
}

/** Internal capabilities exposed to store slices. */
export type StoreInternals = ReturnType<typeof createStoreInternals>;
