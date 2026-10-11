import type { StoreApi } from "zustand";
import { assertAllocationRefs, getOwned as findOwnedIn } from "@capacitylens/shared/domain/mutations";
import { m } from "@/i18n";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { NEUTRAL_COLOR, snapToPresetColor } from "@capacitylens/shared/lib/color";
import type { AppData, ID, ScopedEntityKey, Weekday } from "@capacitylens/shared/types/entities";
import { isWeekdaySet } from "@capacitylens/shared/lib/accountWorkingDays";
import type { StoreState } from "./types";

interface SnapColorInput {
  color: unknown;
  allowNeutral?: boolean | undefined;
}

interface ApplySnappedColorInput<T extends { color?: unknown }> {
  patch: T;
  allowNeutral?: boolean | undefined;
}

/** Create guards that enforce account scoping and entity invariants. */
export function createGuards(get: StoreApi<StoreState>["getState"]) {
  // Every scoped add* stamps the active account. A non-null selection alone is insufficient. The
  // account must either exist in the published data or in the server-authorised summaries while a
  // switch is loading its slice (mid-switch edits are deliberately rebased by persist.ts). An id in
  // neither source is dead, so fail loudly rather than stamp an orphan accountId into the slice.
  const requireAccount = (): ID => {
    const state = get();
    const id = state.activeAccountId;
    if (!id) throw new Error("No active account — cannot mutate scoped data.");
    if (state.activeAccountLoadFailed === id) {
      throw new Error("The active account is not loaded — cannot mutate scoped data.");
    }
    if (
      !state.data.accounts.some((account) => account.id === id) &&
      !state.accountSummaries.some((account) => account.id === id)
    ) {
      throw new Error("The active account is not loaded — cannot mutate scoped data.");
    }
    return id;
  };

  // Refuse writes during masquerade or for viewers so local state cannot diverge from the server.
  // Return a notice instead of throwing because callers use this guard for interactive mutations.
  const blockedByViewer = (): boolean => {
    const state = get();
    if (state.masquerade.kind !== "inactive") {
      state.setNotice(m.notice_masquerade_read_only(), "error");
      return true;
    }
    if (state.activeRole !== "viewer") return false;
    let message = m.notice_viewer_read_only();
    if (state.activeRoleStatus === "pending") message = m.access_checking_summary();
    if (state.activeRoleStatus === "unavailable") message = m.access_unavailable_summary();
    state.setNotice(message, "error");
    return true;
  };

  return buildGuards({ get, requireAccount, blockedByViewer });
}

interface BuildGuardsInput {
  get: StoreApi<StoreState>["getState"];
  requireAccount: () => ID;
  blockedByViewer: () => boolean;
}

function buildGuards({ get, requireAccount, blockedByViewer }: BuildGuardsInput) {
  // Inject the active account for owned-row lookups; the remaining shared guards
  // are used directly at their call sites.
  const resolveOwnedRow = <K extends ScopedEntityKey>(data: AppData, key: K, id: ID): AppData[K][number] | null =>
    findOwnedIn(data, requireAccount(), key, id);
  const assertAllocation = assertAllocationRefs;

  // The built-in "Internal" client is a fixed bucket, every account must keep exactly one, so it
  // may be neither renamed nor moved through the lifecycle. One guard for all four rejecting
  // actions, each supplying the verb its message ends with. A non-client entity, a stale id and an
  // owned ordinary client all pass. Throws a display-safe message: surface, don't swallow (the callers
  // catch and show it; the UI also hides the affordance). See shared/src/data/internalClient.ts.
  const assertNotBuiltinClient = (entity: ScopedEntityKey, id: ID, verb: "renamed" | "archived" | "deleted"): void => {
    if (entity !== "clients") return;
    const client = resolveOwnedRow(get().data, "clients", id);
    if (client && isBuiltinClient(client)) {
      throw new Error(`The Internal client is built in and cannot be ${verb}.`);
    }
  };

  // Value-level integrity backstop: a resource with zero working days has no capacity
  // any day. The form guards this, but the store is the last line so no path can persist
  // it. (The import path instead repairs an empty set to Mon–Fri, see sanitizeImport.)
  // The guards share one shape rule, a distinct set of in-week weekday numbers, from the
  // shared isWeekdaySet, and enforce the same policy for resources and companies: at least
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
  // Use the shared mapper so client and server persist the same preset colour. `allowNeutral` preserves the
  // one deliberate exception: NEUTRAL_COLOR is not itself a preset (see shared/lib/color.ts), but
  // an external resource's grey must round-trip unchanged rather than snap to its nearest preset.
  //
  // Apply colour repair only after rejection checks so a failed write cannot alter an unsaved entity.
  const snapColor = ({ color, allowNeutral = false }: SnapColorInput): string =>
    allowNeutral && color === NEUTRAL_COLOR ? color : snapToPresetColor(color);

  const applySnappedColor = <T extends { color?: unknown }>({
    patch,
    allowNeutral = false,
  }: ApplySnappedColorInput<T>): T =>
    patch.color === undefined
      ? patch
      : { ...patch, color: snapColor({ color: patch.color, allowNeutral: allowNeutral }) };

  return {
    requireAccount,
    blockedByViewer,
    resolveOwnedRow,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    assertHalfDays,
    snapColor,
    applySnappedColor,
  };
}
