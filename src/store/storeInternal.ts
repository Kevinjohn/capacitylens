import type { StoreApi } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import { assertDateRange, remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import { clampHoursPerDay } from "@capacitylens/shared/types/entities";
import type { Allocation, AppData, Entity, ID, ScopedEntityKey } from "@capacitylens/shared/types/entities";
import {
  clearEntityLenses,
  type Draft,
  type ImportSummary,
  type ScopedPatch,
  type ScopedRow,
  type StoreState,
} from "./types";
import { stamp, touch, touchAfter } from "./revisions";
import { HISTORY_LIMIT } from "./history";
import { resetSchedulerView } from "./storeConstants";
import { createGuards } from "./storeGuards";

export * from "./revisions";
export * from "./history";
export * from "./storeConstants";

export function createStoreInternals(set: StoreApi<StoreState>["setState"], get: StoreApi<StoreState>["getState"]) {
  // Every data mutation goes through mutate(): it snapshots the previous data
  // onto the undo stack and clears the redo stack.
  //
  // DO NOT wrap mutate(), its producers, undo/redo, the assert* helpers, or importData in a
  // try/catch to "be safe". Their integrity throws are the store's whole point — the last line that
  // stops bad multi-tenant data being persisted. Swallowing here would convert a loud, fixable
  // rejection into SILENT data corruption (the explicit anti-goal; see DEFENSIVE-CODING.md §4). If
  // a producer throws, `set` never runs, so state is left untouched — a clean, atomic failure.
  const mutate = (producer: (d: AppData) => AppData) =>
    set((s) => ({
      data: producer(s.data),
      past: [...s.past, s.data].slice(-HISTORY_LIMIT),
      future: [],
    }));

  // Erasure/purge actions must not leave a recoverable pre-erasure snapshot in memory. They also
  // cannot honestly be undoable, so clear both history directions as part of the same state write.
  const mutateIrreversible = (producer: (d: AppData) => AppData) =>
    set((s) => ({ data: producer(s.data), past: [], future: [] }));

  const applyPatch = <T extends Entity>(row: T, patch: Partial<Omit<T, keyof Entity>>): T => {
    const next = { ...row, ...patch } as T;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
    }
    return next;
  };
  const updateById = <T extends Entity>(list: T[], id: ID, patch: Partial<Omit<T, keyof Entity>>): T[] =>
    list.map((row) => (row.id === id ? { ...applyPatch(row, patch), updatedAt: touchAfter(row.updatedAt) } : row));

  const {
    requireAccount,
    blockedByViewer,
    findOwned,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    assertHalfDays,
    snapColor,
    withSnappedColor,
  } = createGuards(get, set);

  // --- Write-shape wrappers ---------------------------------------------------------------------
  // Two rules used to be re-stated by hand in every action, so a NEW action could silently get
  // either one wrong: (1) the viewer gate must run BEFORE any assert, colour repair or persist, and
  // (2) an update must validate the MERGED row rather than the raw patch. The wrappers below make
  // both structural; each action then declares only what is specific to it.

  /** Run `fn` only when the caller may write; a blocked viewer gets `blockedValue` plus a notice and
   *  nothing runs. `fn` is first so TypeScript infers the return type from it and checks the blocked
   *  value against it — omit the value entirely for the void actions. */
  const guarded =
    <A extends unknown[], R>(fn: (...args: A) => R, blockedValue?: R) =>
    (...args: A): R =>
      blockedByViewer() ? (blockedValue as R) : fn(...args);

  /** The add* shape. `build` CONSTRUCTS the entity only — it may resolve the active account, but must
   *  never validate, repair a colour or persist — then the gate runs, then `persist` asserts/repairs/
   *  commits. So a blocked viewer gets back exactly the row they submitted, never a value we silently
   *  changed on their behalf, and nothing lands in state. Server 403 is the real backstop. */
  const guardedAdd =
    <A extends unknown[], E>(build: (...args: A) => E, persist: (built: E, ...args: A) => E) =>
    (...args: A): E => {
      const built = build(...args);
      return blockedByViewer() ? built : persist(built, ...args);
    };

  /** The update* shape: resolve the owned row (a stale id — e.g. a drag committed after an undo
   *  removed the row — is a benign no-op returning false), hand `prepare` the MERGED row so
   *  validation sees exactly what will be committed, then commit the patch `prepare` returns.
   *  Validating the raw patch instead used to let a note-only edit pass locally while the server —
   *  which always merges before it validates — rejected the full row, diverging local from synced
   *  state. `prepare` may also throw (surface, don't swallow) and may repair the patch it returns;
   *  `cascade` adds dependent table writes to that same mutation/history entry. */
  const updateOwned = <K extends ScopedEntityKey>(
    key: K,
    id: ID,
    patch: ScopedPatch<K>,
    prepare?: (merged: ScopedRow<K>, existing: ScopedRow<K>) => ScopedPatch<K>,
    cascade?: (data: AppData, merged: ScopedRow<K>, existing: ScopedRow<K>) => AppData,
  ): boolean => {
    const existing = findOwned(get().data, key, id);
    if (!existing) return false;
    const effective = prepare
      ? prepare(applyPatch(existing, patch as Partial<Omit<ScopedRow<K>, keyof Entity>>), existing)
      : patch;
    // The table key is generic here, so TS can't narrow d[key] to a single row type; K pins the row
    // and patch types at every call site above, which is where correctness is actually checked.
    mutate((d) => {
      const rows = updateById(d[key] as Entity[], id, effective as Partial<Entity>);
      const next = { ...d, [key]: rows } as AppData;
      return cascade
        ? cascade(next, applyPatch(existing, effective as Partial<Omit<ScopedRow<K>, keyof Entity>>), existing)
        : next;
    });
    return true;
  };

  // One shared implementation keeps single and repeated creation behavior identical. Build and
  // validate every row before mutate() so a bad middle draft cannot publish, persist or enter history.
  const addAllocationsImpl = (inputs: readonly Draft<Allocation>[]): Allocation[] => {
    if (inputs.length === 0) throw new Error("At least one allocation is required.");
    const accountId = requireAccount();
    const allocations = inputs.map((input) => ({
      ...input,
      hoursPerDay: clampHoursPerDay(input.hoursPerDay),
      id: newId(),
      accountId,
      ...stamp(),
    }));
    // Preserve the existing add* contract: a Viewer receives a constructed return value plus the
    // visible read-only notice, but no validation or state mutation runs. Hand-gated rather than
    // wrapped in `guarded`, whose blocked value is fixed up front: here it is the batch this call
    // just built, which only exists after the pre-check work above.
    if (blockedByViewer()) return allocations;
    const data = get().data;
    for (const allocation of allocations) {
      assertAllocation(
        data,
        accountId,
        allocation.resourceId,
        allocation.activityId,
        allocation.hoursPerDay,
        allocation.projectId,
      );
      assertDateRange(allocation.startDate, allocation.endDate);
    }
    mutate((d) => ({ ...d, allocations: [...d.allocations, ...allocations] }));
    return allocations;
  };

  // Replace the active account's slice from an import (see the importData action for the id-remap
  // rationale). Wrapped in the shared viewer gate, whose zero-effect summary reports honestly that
  // nothing was imported or skipped.
  const importSlice = guarded(
    (accountId: ID, incoming: AppData): ImportSummary => {
      const result = remapAndValidateImport(get().data, accountId, incoming, touch());
      // Refuse a zero-record import rather than wiping the account's existing slice.
      // Replacing a company's data with nothing is never the intent (delete is the
      // explicit path for that), and a truncated/empty file otherwise slips past the
      // shape-only file guard and silently clears the account.
      if (result.imported === 0) return { imported: 0, skipped: result.skipped };
      set((state) => ({
        data: result.data,
        past: [...state.past, state.data].slice(-HISTORY_LIMIT),
        future: [],
        // The incoming rows carry FRESH ids, so the entity lenses can no longer resolve; the search
        // text and the tentative/unmatched preferences are the user's own and survive.
        ui: { ...resetSchedulerView(state.ui), filters: clearEntityLenses(state.ui.filters) },
      }));
      return { imported: result.imported, skipped: result.skipped };
    },
    { imported: 0, skipped: 0 },
  );

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
    findOwned,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    assertHalfDays,
    snapColor,
    withSnappedColor,
    guarded,
    guardedAdd,
    updateOwned,
    addAllocationsImpl,
    importSlice,
  };
}

export type StoreInternals = ReturnType<typeof createStoreInternals>;
