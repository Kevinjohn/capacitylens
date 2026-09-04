import type { StoreApi } from "zustand";
import { assertAllocationRefs, findOwned as findOwnedIn } from "@capacitylens/shared/domain/mutations";
import { m } from "@/i18n";
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { NEUTRAL_COLOR, snapToPresetColor } from "@capacitylens/shared/lib/color";
import type { AppData, ID, ScopedEntityKey, Weekday } from "@capacitylens/shared/types/entities";
import { isWeekdaySet } from "@capacitylens/shared/lib/accountWorkingDays";
import type { StoreState } from "./types";

export function createGuards(get: StoreApi<StoreState>["getState"], set: StoreApi<StoreState>["setState"]) {
  // Notices use the store action; retain the factory's get/set dependency boundary.
  void set;

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

  return {
    requireAccount,
    blockedByViewer,
    findOwned,
    assertAllocation,
    assertNotBuiltinClient,
    assertWorkingDays,
    assertHalfDays,
    snapColor,
    withSnappedColor,
  };
}
