import type { StateCreator } from "zustand";
import { m } from "@/i18n";
import {
  applyDemoRowCommands,
  buildClearedSession,
  hasSameEntityRevisions,
  HISTORY_LIMIT,
  resetSchedulerView,
} from "@/store/storeInternal";
import type { StoreInternals } from "@/store/storeInternal";
import { readCurrentWeekAnchor } from "./schedulerSlice";
import type { StoreState } from "@/store/types";

type HistorySlice = Pick<StoreState, "past" | "future" | "replaceAll" | "importData" | "undo" | "redo">;
type HistorySliceInternals = Pick<StoreInternals, "createGuardedAction" | "importSlice" | "requireAccount">;

/** Create undo and redo actions for the store. */
export function createHistorySlice(internals: HistorySliceInternals): StateCreator<StoreState, [], [], HistorySlice> {
  return (set) => {
    const { createGuardedAction, importSlice, requireAccount } = internals;
    return {
      past: [],
      future: [],
      replaceAll: (data) => set((state) => replaceAllState(state, data)),
      // Replace only the selected tenant and remap imported IDs so a foreign export cannot
      // collide with another account’s globally matched rows. Require an account before
      // the viewer gate so a missing scope remains a programming error rather than a refusal.
      importData: (incoming) => importSlice(requireAccount(), incoming),

      undo: createGuardedAction(() => {
        set((state) => {
          if (state.past.length === 0) return {};
          const entry = state.past[state.past.length - 1];
          if (!entry) return {};
          const previous = applyDemoRowCommands(state.data, entry.inverse);
          return {
            data: previous,
            past: state.past.slice(0, -1),
            future: [entry, ...state.future].slice(0, HISTORY_LIMIT),
          };
        });
      }),
      redo: createGuardedAction(() => {
        set((state) => {
          if (state.future.length === 0) return {};
          const entry = state.future[0];
          if (!entry) return {};
          const next = applyDemoRowCommands(state.data, entry.forward);
          return {
            data: next,
            future: state.future.slice(1),
            past: [...state.past, entry].slice(-HISTORY_LIMIT),
          };
        });
      }),
    };
  };
}

function replaceAllState(state: StoreState, data: StoreState["data"]): Partial<StoreState> {
  const previouslyHadActiveAccount = state.activeAccountId
    ? state.data.accounts.some((candidate) => candidate.id === state.activeAccountId)
    : false;
  const account = state.activeAccountId
    ? data.accounts.find((candidate) => candidate.id === state.activeAccountId)
    : undefined;
  const unchangedActiveSlice = previouslyHadActiveAccount && hasSameEntityRevisions(state.data, data);
  // A replacement is a publication boundary: never retain an active id that the newly
  // published slice does not contain. This can happen after membership revocation, a malformed
  // response, recovery, or a direct store call. Clear the selection in the same state write so
  // observers cannot see the new data under the dead tenant even for one notification, and do
  // not retain it as the picker's "back" target. requireAccount independently enforces the same
  // invariant at every scoped mutation boundary.
  if (state.activeAccountId && !account) {
    return {
      data,
      activeAccountId: null,
      previousAccountId: null,
      activeRole: null,
      activeRoleStatus: "not-applicable",
      notice: {
        message: m.notice_company_not_found(),
        tone: "error" as const,
      },
      ...buildClearedSession(),
      past: [],
      future: [],
      // No anchor: a publication is not a navigation, so the week in view is left alone.
      ui: resetSchedulerView(state.ui),
    };
  }
  // Same-account refreshes reconcile server state in the background and must preserve the
  // week the user is viewing. Re-anchor only when setActiveAccount had to use its temporary
  // GMT/Monday fallback because the selected account was absent from the previous slice.
  if (!account || previouslyHadActiveAccount) {
    // A no-op server refresh may replace every object identity, but identical ids and
    // authoritative revisions prove that no row changed. Preserve undo/redo only in that
    // exact case. Any remote addition, deletion or revision change clears history because
    // a local inverse could otherwise resurrect or overwrite remote work.
    return unchangedActiveSlice ? { data } : { data, past: [], future: [] };
  }
  return {
    data,
    past: [],
    future: [],
    ui: { ...state.ui, ...readCurrentWeekAnchor(data, account.id) },
  };
}
