import type { StateCreator } from "zustand";
import { m } from "@/i18n";
import {
  clearedSession,
  hasSameEntityRevisions,
  HISTORY_LIMIT,
  prepareHistoryTarget,
  resetSchedulerView,
  type StoreInternals,
} from "../storeInternal";
import { weekAnchor } from "./schedulerSlice";
import type { StoreState } from "../types";

type HistorySlice = Pick<StoreState, "past" | "future" | "replaceAll" | "importData" | "undo" | "redo">;

export function createHistorySlice(internals: StoreInternals): StateCreator<StoreState, [], [], HistorySlice> {
  return (set) => {
    const { guarded, importSlice, requireAccount } = internals;
    return {
      past: [],
      future: [],
      replaceAll: (data) =>
        set((state) => {
          const previouslyHadActiveAccount = state.activeAccountId
            ? state.data.accounts.some((candidate) => candidate.id === state.activeAccountId)
            : false;
          const account = state.activeAccountId
            ? data.accounts.find((candidate) => candidate.id === state.activeAccountId)
            : undefined;
          const unchangedActiveSlice = previouslyHadActiveAccount && hasSameEntityRevisions(state.data, data);
          // A replacement is a publication boundary: never retain an active id that the newly
          // published slice does not contain. This can happen after membership revocation, a malformed
          // response, recovery, or a direct store call. Clear the selection in the SAME state write so
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
              ...clearedSession(),
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
            // exact case. Any remote addition, deletion or revision change clears history because a
            // historical whole-slice snapshot could otherwise resurrect or overwrite remote work.
            return unchangedActiveSlice ? { data } : { data, past: [], future: [] };
          }
          return {
            data,
            past: [],
            future: [],
            ui: { ...state.ui, ...weekAnchor(data, account.id) },
          };
        }),
      // Replace only the active account's slice; other accounts and the account
      // list itself are untouched. Undoable via ⌘Z.
      //
      // Imported entities keep their relationships but are given FRESH ids. An
      // exported file carries the source account's ids; re-importing it into a
      // different account would otherwise collide — the store matches entities by
      // id GLOBALLY (updateById / cascade scan all accounts), so a shared id would
      // let an edit in one account silently rewrite another's row.
      // The account is resolved at the CALL, ahead of the shared viewer gate: replacing a slice with
      // NO active account is a programming error for every role, so requireAccount must still throw
      // where `guarded` would merely refuse. Viewer no-op (P1.12 defense-in-depth): a read-only user
      // can't replace the account slice, and gets a zero-effect summary so the caller reports honestly.
      importData: (incoming) => importSlice(requireAccount(), incoming),

      undo: guarded(() => {
        set((s) => {
          if (s.past.length === 0) return {};
          const previous = prepareHistoryTarget(s.data, s.past[s.past.length - 1]);
          return {
            data: previous,
            past: s.past.slice(0, -1),
            future: [s.data, ...s.future].slice(0, HISTORY_LIMIT),
          };
        });
      }),
      redo: guarded(() => {
        set((s) => {
          if (s.future.length === 0) return {};
          const next = prepareHistoryTarget(s.data, s.future[0]);
          return {
            data: next,
            future: s.future.slice(1),
            past: [...s.past, s.data].slice(-HISTORY_LIMIT),
          };
        });
      }),
    };
  };
}
