import type { StoreApi } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import { deleteClientCascade, deleteProjectCascade, deleteResourceCascade } from "@capacitylens/shared/lib/integrity";
import {
  assertAllocationRefs,
  assertDateRange,
  findOwned as findOwnedIn,
  remapAndValidateImport,
} from "@capacitylens/shared/domain/mutations";
import { m } from "@/i18n";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import type { AppDataKey } from "@capacitylens/shared/types/entities";
import { APP_DATA_KEYS, clampHoursPerDay, emptyAppData } from "@capacitylens/shared/types/entities";
import { NEUTRAL_COLOR, snapToPresetColor } from "@capacitylens/shared/lib/color";
import type {
  Allocation,
  AppData,
  Entity,
  ID,
  ISODate,
  ScopedEntityKey,
  Weekday,
} from "@capacitylens/shared/types/entities";
import { isWeekdaySet } from "@capacitylens/shared/lib/accountWorkingDays";
import {
  clearEntityLenses,
  emptyFilters,
  type Draft,
  type ImportSummary,
  type LifecycleEntity,
  type SchedulerUI,
  type ScopedPatch,
  type ScopedRow,
  type StoreState,
} from "./types";

export const stamp = () => {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
};
export const touch = () => new Date().toISOString();
const MAX_DATE_MS = 8_640_000_000_000_000;
// Take an ARRAY, not rest args: the whole-tenant callers (nextDataRevision, prepareHistoryTarget)
// pass one timestamp per row, and spreading tens of thousands of rows as function arguments can
// overflow the engine's argument limit (RangeError), failing an undo/redo or cascade-delete
// outright. Iterating an array is unbounded-safe. `touchAfter` keeps the ergonomic variadic shape
// for the many few-arg callers by delegating here.
export const advancePast = (value: string | undefined, next: number): number => {
  if (!value) return next;
  const parsed = Date.parse(value);
  // The maximum representable Date is valid ISO input but has no representable successor. Refuse
  // the write explicitly; publishing Date.now() here would silently move its revision backwards.
  if (parsed === MAX_DATE_MS) {
    throw new Error("Cannot update data whose revision has no representable successor.");
  }
  return Number.isFinite(parsed) && parsed >= next ? parsed + 1 : next;
};
export const touchAfterAll = (timestamps: Array<string | undefined>): string => {
  let next = Date.now();
  for (const value of timestamps) next = advancePast(value, next);
  return new Date(next).toISOString();
};
export const touchAfter = (...timestamps: Array<string | undefined>): string => touchAfterAll(timestamps);
// Fold a WHOLE tenant's revisions into the running maximum in ONE pass. Materialising the
// timestamps first would allocate an array per table (tens of thousands of strings on a large
// account) for a value only ever reduced to a single number.
export const advanceOverData = (data: AppData, next: number): number => {
  let result = next;
  for (const rows of Object.values(data) as Entity[][]) {
    for (const row of rows) result = advancePast(row.updatedAt, result);
  }
  return result;
};
export const nextDataRevision = (data: AppData): string => new Date(advanceOverData(data, Date.now())).toISOString();

/**
 * Undo/redo restores historical values, but `updatedAt` is a synchronization revision rather than
 * user history. Re-stamp every surviving row whose content changes across the history transition;
 * otherwise the diff engine either misses a restored FK or the server rejects the old timestamp as
 * stale. Rows recreated from deletion need no stamp because the server has no current row to beat.
 */
export function prepareHistoryTarget(current: AppData, target: AppData): AppData {
  const now = new Date(advanceOverData(target, advanceOverData(current, Date.now()))).toISOString();
  const retime = <T extends Entity>(beforeRows: T[], targetRows: T[]): T[] => {
    // Immutable mutations structurally share every untouched table. Preserve that array wholesale;
    // even within a changed table, untouched rows retain object identity and need no serialization.
    if (beforeRows === targetRows) return targetRows;
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
    const content = (row: T): string => JSON.stringify({ ...row, updatedAt: undefined });
    return targetRows.map((row) => {
      const before = beforeById.get(row.id);
      if (before === row) return row;
      return before && (before.updatedAt !== row.updatedAt || content(before) !== content(row))
        ? { ...row, updatedAt: now }
        : row;
    });
  };
  // Driven by the shared key list (same altitude as hasSameEntityRevisions below) so a new AppData
  // table can't be silently dropped from the history transition by a missed hand-written line. The
  // row type is erased to Entity here; each table's real type is restored by the AppData return.
  const next = emptyAppData() as Record<AppDataKey, Entity[]>;
  for (const key of APP_DATA_KEYS) {
    next[key] = retime(current[key] as Entity[], target[key] as Entity[]);
  }
  return next as AppData;
}

/** True when a server refresh republishes the same authoritative entity revisions. */
export function hasSameEntityRevisions(current: AppData, replacement: AppData): boolean {
  for (const key of Object.keys(current) as Array<keyof AppData>) {
    const currentRows = current[key];
    const replacementRows = replacement[key];
    if (currentRows.length !== replacementRows.length) return false;
    const replacementRevisions = new Map(replacementRows.map((row) => [row.id, row.updatedAt]));
    if (currentRows.some((row) => replacementRevisions.get(row.id) !== row.updatedAt)) {
      return false;
    }
  }
  return true;
}

export const HISTORY_LIMIT = 50;

/** How each tombstone table is physically removed at the END of the lifecycle (purgeEntity): the
 *  row AND its children go together, via the SAME cascades the regular delete* actions use
 *  (single-sourced from shared/lib/integrity.ts — no drift). The resource cascade re-stamps
 *  nothing, so it alone needs no fresh revision. */
export const PURGE_CASCADES: Record<LifecycleEntity, (data: AppData, id: ID) => AppData> = {
  resources: (data, id) => deleteResourceCascade(data, id),
  clients: (data, id) => deleteClientCascade(data, id, nextDataRevision(data)),
  projects: (data, id) => deleteProjectCascade(data, id, nextDataRevision(data)),
};

// --- Tenant-boundary resets ----------------------------------------------------------------------
// Deleting, switching, publishing a slice without the active tenant, or importing over one all cross
// a tenant boundary, and none of them may carry the LEAVING account's transient session state or
// scheduler view into what is shown next. The field sets live here ONCE so a boundary can't quietly
// forget one; each site keeps only what is specific to it (which notice, whether the week is
// re-anchored, which filters survive).

/** Every transient, tenant-owned session field, cleared. `notice` is deliberately NOT included:
 *  each boundary has its own message (or none). */
export const clearedSession = () => ({
  srAnnouncement: null,
  dirtyForm: false,
  dirtyFormSources: new Set<symbol>(),
  draggingAllocationId: null,
});

/** The scheduler view blanked for the incoming tenant. Pass an `anchor` ({@link weekAnchor}) to ALSO
 *  open on that account's current week; omit it where the week in view must be preserved. */
export const resetSchedulerView = (
  ui: SchedulerUI,
  anchor?: { originDate: ISODate; focusDate: ISODate },
): SchedulerUI => ({
  ...ui,
  filters: emptyFilters(),
  collapsedGroups: [],
  selectedAllocationId: null,
  scrollToResource: null,
  ...anchor,
});

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

  // Every scoped add* stamps the active account. A non-null selection alone is insufficient. The
  // account must either exist in the published data or in the server-authorised summaries while a
  // switch is loading its slice (mid-switch edits are deliberately rebased by persist.ts). An id in
  // neither source is dead, so fail loudly rather than stamp an orphan accountId into the slice.
  const requireAccount = (): ID => {
    const state = get();
    const id = state.activeAccountId;
    if (!id) throw new Error("No active account — cannot mutate scoped data.");
    if (
      !state.data.accounts.some((account) => account.id === id) &&
      !state.accountSummaries.some((account) => account.id === id)
    ) {
      throw new Error("The active account is not loaded — cannot mutate scoped data.");
    }
    return id;
  };

  // Defense-in-depth viewer guard (P1.12). It is INERT unless the active role is EXACTLY 'viewer':
  // every other value — null (OFF/local/not-fetched), 'owner', 'admin', 'editor' — permits, so the
  // default deploy is byte-identical to today (fully editable). When the role IS 'viewer', a scoped
  // mutation NO-OPS (the caller returns early) and surfaces a notice, so an ungated affordance or an
  // optimistic local write the server would 403 can't desync local state. This is UX/defense-in-depth,
  // NOT the security boundary — the server 403 (P1.5) is the true backstop; we never throw here (a
  // throw would read as corruption and could crash a drag handler), we just refuse + inform.
  const blockedByViewer = (): boolean => {
    const state = get();
    if (state.masquerade.phase !== "inactive") {
      state.setNotice(m.notice_masquerade_read_only(), "error");
      return true;
    }
    if (state.activeRole !== "viewer") return false;
    const message =
      state.activeRoleStatus === "pending"
        ? m.access_checking_summary()
        : state.activeRoleStatus === "unavailable"
          ? m.access_unavailable_summary()
          : m.notice_viewer_read_only();
    state.setNotice(message, "error");
    return true;
  };

  // Tenancy + integrity rules now live in src/domain/mutations.ts (pure, shared
  // with a future server). findOwned is wrapped here to inject the active account
  // so the call sites stay terse; assertAllocation keeps its legacy name locally.
  // assertScopedRefs / assertDateRange / assertResourceExists are used directly
  // from the import above.
  const findOwned = <K extends ScopedEntityKey>(d: AppData, key: K, id: ID): AppData[K][number] | null =>
    findOwnedIn(d, requireAccount(), key, id);
  const assertAllocation = assertAllocationRefs;

  // The built-in "Internal" client is a FIXED bucket — every account must keep exactly one — so it
  // may be neither renamed nor moved through the lifecycle. One guard for all four rejecting
  // actions, each supplying the verb its message ends with. A non-client entity, a stale id and an
  // ordinary client all pass. Throws a display-safe message: surface, don't swallow (the callers
  // catch and show it; the UI also hides the affordance). See shared/src/data/internalClient.ts.
  const assertNotBuiltinClient = (entity: ScopedEntityKey, id: ID, verb: "renamed" | "archived" | "deleted"): void => {
    if (entity !== "clients") return;
    const client = findOwned(get().data, "clients", id);
    if (client && isBuiltinClient(client)) {
      throw new Error(`The Internal client is built in and cannot be ${verb}.`);
    }
  };

  // Value-level integrity backstop: a resource with zero working days has no capacity
  // any day. The form guards this, but the store is the last line so no path can persist
  // it. (The import path instead REPAIRS an empty set to Mon–Fri — see sanitizeImport.)
  // The three guards share ONE shape rule — a distinct set of in-week weekday numbers, from the
  // shared isWeekdaySet — and now enforce the SAME policy for resources and companies: at least
  // one working day, because company days govern capacity and an empty company week would zero
  // every person. A half day must additionally be a working day.
  const assertWorkingDays = (days: Weekday[]): void => {
    if (!isWeekdaySet(days) || days.length === 0) {
      throw new Error("At least one working day is required, using unique whole-number weekdays from 0 to 6.");
    }
  };
  const assertHalfDays = (halfDays: Weekday[], workingDays: Weekday[]): void => {
    if (!isWeekdaySet(halfDays) || halfDays.some((day) => !workingDays.includes(day))) {
      throw new Error("Half days must be unique whole-number weekdays contained in the working week.");
    }
  };
  // Write-time colour guard: snaps a bad/legacy colour to its NEAREST palette preset via the
  // shared snapToPresetColor mapper — the SAME mapper the server's sanitizeWrite('accounts') and
  // the one-time snap-legacy-account-colors migration use, so client and server can never
  // disagree about what a given colour snaps to (see DECISIONS.md). `allowNeutral` preserves the
  // ONE deliberate exception: NEUTRAL_COLOR is not itself a preset (see shared/lib/color.ts), but
  // an external resource's grey must round-trip unchanged rather than snap to its nearest preset.
  //
  // Deliberately called ONLY on a path that is actually about to persist (immediately before
  // mutate()/updateById below) — never before a reject check (blockedByViewer / a stale-id no-op /
  // an assert* throw). A rejected write must not silently substitute a colour the caller never
  // asked for onto an entity that was never saved; see the CRUD contract note on StoreState.
  const snapColor = (color: unknown, allowNeutral = false): string =>
    allowNeutral && color === NEUTRAL_COLOR ? (color as string) : snapToPresetColor(color);

  // Collapses the `patch.color === undefined ? patch : { ...patch, color: snapColor(...) }`
  // idiom that used to be copy-pasted across every update* action (P#: colour-repair
  // consolidation). Returns the SAME object reference when there's no colour to repair, so a
  // colourless edit doesn't pay for a needless clone.
  const withSnappedColor = <T extends { color?: unknown }>(patch: T, allowNeutral = false): T =>
    patch.color === undefined ? patch : { ...patch, color: snapColor(patch.color, allowNeutral) };

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
