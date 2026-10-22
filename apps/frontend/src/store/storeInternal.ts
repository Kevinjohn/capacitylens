import type { StoreApi } from "zustand";
import { remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import type { AppData, Entity, ID } from "@capacitylens/shared/types/entities";
import { clearEntityLenses } from "./types";
import type { ImportSummary, Patch, StoreState } from "./types";
import { touch } from "./revisions";
import { HISTORY_LIMIT } from "./history";
import { resetSchedulerView } from "./storeConstants";
import { createGuards } from "./storeGuards";

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

  return { mutate };
}

const applyPatch = <T extends Entity>(row: T, patch: Patch<T>): T => {
  const next = { ...row, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) Object.assign(next, { [key]: null });
  }
  return next;
};

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
  return { createGuardedAction, createGuardedValueAction };
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
  const { mutate } = createMutationActions(set);

  const {
    requireAccount,
    blockedByViewer,
    resolveOwnedRow,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    snapColor,
  } = createGuards(get);

  const { createGuardedAction, createGuardedValueAction } = createGuardedActions(blockedByViewer);
  const importSlice = createImportAction(set, get, createGuardedValueAction);

  // clampHoursPerDay (allocations, [0,24]) and clampWorkingHoursPerDay (resources, (0,24])
  // come from the shared core (entities.ts) so the store write boundary and the import
  // sanitiser apply the identical clamp. No per-path drift.

  return {
    mutate,
    applyPatch,
    requireAccount,
    blockedByViewer,
    resolveOwnedRow,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    snapColor,
    createGuardedAction,
    createGuardedValueAction,
    importSlice,
  };
}

/** Internal capabilities exposed to store slices. */
export type StoreInternals = ReturnType<typeof createStoreInternals>;
