import type { StateCreator } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import { deleteAccountCascade } from "@capacitylens/shared/domain/mutations";
import { m } from "@/i18n";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Account, ID } from "@capacitylens/shared/types/entities";
import { buildClearedSession, resetSchedulerView, stamp, type StoreInternals } from "../storeInternal";
import { readCurrentWeekAnchor } from "./schedulerSlice";
import type { Draft, Patch, StoreState } from "../types";

type AccountSlice = Pick<
  StoreState,
  | "data"
  | "activeAccountId"
  | "previousAccountId"
  | "accountSummaries"
  | "accountSummariesComplete"
  | "accountSummariesRequestId"
  | "addAccount"
  | "updateAccount"
  | "deleteAccount"
  | "setActiveAccount"
  | "beginAccountSummariesRequest"
  | "setAccountSummaries"
>;

export function createAccountSlice(internals: StoreInternals): StateCreator<StoreState, [], [], AccountSlice> {
  return (set, get) => {
    const { createGuardedAction, assertWorkingDays, snapColor, mutate, updateById, applySnappedColor } = internals;
    return {
      data: emptyAppData(),
      activeAccountId: null,
      previousAccountId: null,
      accountSummaries: [],
      accountSummariesComplete: false,
      accountSummariesRequestId: 0,
      addAccount: createGuardedAction((input: Draft<Account>): Account | null => {
        const timestamps = stamp();
        const weekStartsOn = input.weekStartsOn ?? 1;
        if (input.workingDays !== undefined) assertWorkingDays(input.workingDays);
        // New-company defaults for the per-account view settings: brand-new tenants start in 'days'
        // scheduling with disciplines OFF, placeholder + external features hidden, and Internal work
        // grey. `...input`
        // comes LAST so a caller (or an import path) can still override any of them; existing/seed
        // accounts that never pass through addAccount keep their absent-field defaults (read via the
        // selectors). placeholdersEnabled/externalEnabled were device-global prefs and are now
        // per-account, mirroring disciplinesEnabled.
        const entity: Account = {
          schedulingMode: "days",
          disciplinesEnabled: false,
          placeholdersEnabled: false,
          externalEnabled: false,
          internalColourMode: "grey",
          ...input,
          workingDays: normalizeAccountWorkingDays(input.workingDays, weekStartsOn),
          color: snapColor({ color: input.color }),
          id: newId(),
          ...timestamps,
        };
        // Every new account gets its built-in "Internal" client (one per account; see
        // internalClient.ts). Created atomically with the account so the one-per-account invariant
        // holds the instant the tenant exists — matching seed() and the v5→v6 migrate.
        const internal = buildInternalClient(entity.id, timestamps.createdAt);
        mutate((data) => ({
          ...data,
          accounts: [...data.accounts, entity],
          clients: [...data.clients, internal],
        }));
        // Keep the picker's list in lockstep (P1.13). This action now runs only in the DEMO build —
        // server-mode create goes through the AccountPicker's dedicated POST /api/orgs path, not here —
        // so this append is the demo bookkeeping that keeps the picker synchronously fresh before the
        // useAccountSummaries derive effect flushes. Append only if absent so a derive that already
        // added it can't duplicate.
        set((state) => ({
          accountSummariesRequestId: state.accountSummariesRequestId + 1,
          accountSummariesComplete: true,
          accountSummaries: state.accountSummaries.some((account) => account.id === entity.id)
            ? state.accountSummaries
            : [...state.accountSummaries, { id: entity.id, name: entity.name, role: "owner" as const }],
        }));
        return entity;
      }, null),
      updateAccount: createGuardedAction((id: ID, patch: Patch<Account>) => {
        const state = get();
        const existing = state.data.accounts.find((account) => account.id === id);
        if (!existing) return;
        if (state.activeAccountId !== id) {
          throw new Error("Cannot update a company other than the active company.");
        }
        if (patch.workingDays !== undefined) assertWorkingDays(patch.workingDays);
        const safePatch =
          patch.workingDays === undefined
            ? patch
            : {
                ...patch,
                workingDays: normalizeAccountWorkingDays(patch.workingDays, existing.weekStartsOn ?? 1),
              };
        mutate((data) => ({
          ...data,
          accounts: updateById(data.accounts, id, applySnappedColor({ patch: safePatch })),
        }));
      }),
      // Cascade-drop every scoped entity belonging to this account; if it was the
      // active one, fall back to the picker.
      deleteAccount: createGuardedAction((id: ID) => {
        if (!get().data.accounts.some((account) => account.id === id)) return;
        if (get().activeAccountId !== null && get().activeAccountId !== id) {
          throw new Error("Cannot delete a company other than the active company.");
        }
        set((state) => {
          const data = deleteAccountCascade(state.data, id);
          return {
            data,
            past: [],
            future: [],
            activeAccountId: state.activeAccountId === id ? null : state.activeAccountId,
            previousAccountId: state.activeAccountId === id ? id : state.previousAccountId,
            accountSummaries: state.accountSummaries.filter((account) => account.id !== id),
            accountSummariesComplete: true,
            accountSummariesRequestId: state.accountSummariesRequestId + 1,
            notice: null,
            ...buildClearedSession(),
            // No tenant remains in view, so the week is re-anchored on the app-default calendar.
            ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(data, null)),
          };
        });
      }),
      // Switching tenant resets per-account view state and history — undo must never
      // cross an account boundary, and the previous account's filters/selection don't apply.
      setActiveAccount: (rawId) => {
        // A non-null id that matches NO account is a stale/unknown tenant. Surface it and drop to the
        // picker rather than silently activating a dead id — a dead id would pass requireAccount() and
        // render an empty schedule as if it were real (exactly the hidden-corruption class we guard
        // against). Never throw: null is legitimate and tests/recovery set ids; the picker is safe.
        //
        // EXISTENCE = the UNION of `data.accounts` (the demo build, and the active slice in server mode) AND
        // `accountSummaries` (server mode, where `data` holds only the active account's slice so a
        // not-yet-loaded tenant is absent from data but present in the summaries the picker showed). The
        // persist switch orchestrator then loads that account's slice into `data`; this validation only
        // proves the id is one the login may open, not that its data is loaded yet.
        let id = rawId;
        let unknownAccount = false;
        if (
          id !== null &&
          !get().data.accounts.some((account) => account.id === id) &&
          !get().accountSummaries.some((account) => account.id === id)
        ) {
          console.warn(`setActiveAccount: no company with id ${JSON.stringify(id)} — returning to the picker`);
          unknownAccount = true;
          id = null;
        }
        set((state) => {
          const switchingAccount = id !== state.activeAccountId;
          return {
            activeAccountId: id,
            // A concrete role means membership enforcement is active. Publish the new tenant with a
            // conservative Viewer role in this SAME store transition so no imperative subscriber can
            // observe it under the prior tenant's authority; PermissionProvider replaces it only
            // after resolving this account. null is the deliberate OFF/demo mode and stays editable.
            activeRole: id !== state.activeAccountId && state.activeRole !== null ? "viewer" : state.activeRole,
            activeRoleStatus:
              id !== state.activeAccountId && state.activeRole !== null ? "pending" : state.activeRoleStatus,
            // Remember where we came from when dropping to the picker (id === null) so it
            // can offer a "back" escape; clear it once a tenant is actually chosen.
            previousAccountId: id === null ? state.activeAccountId : null,
            past: [],
            future: [],
            // These values describe work or UI owned by the account being left. Clear them in the
            // same publication as activeAccountId so no subscriber can observe stale tenant ids,
            // form guards or messages under the new account.
            ...(unknownAccount
              ? // An unknown id ALWAYS surfaces — including when already on the picker, where
                // activeAccountId is already null and no "switch" would otherwise be detected.
                {
                  notice: {
                    message: m.notice_company_not_found(),
                    tone: "error" as const,
                  },
                }
              : switchingAccount
                ? { notice: null, ...buildClearedSession() }
                : {}),
            // Open the switched-into company on the current week (mirrors defaultUI) rather
            // than inheriting the previous tenant's panned origin/focus. The account's tz/weekStartsOn
            // come from its slice when loaded; in server mode the slice loads a frame later (the switch
            // orchestrator awaits the fetch), so fall back to the existing defaults for that one frame
            // (an acceptable transient — the grid re-anchors when the slice arrives via replaceAll).
            ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(state.data, id)),
          };
        });
      },

      // Plain transient state (NOT mutate): never on the undo/redo stack or in AppData/export.
      beginAccountSummariesRequest: () => {
        const requestId = get().accountSummariesRequestId + 1;
        set({ accountSummariesRequestId: requestId });
        return requestId;
      },
      setAccountSummaries: (list, requestId, complete = true) => {
        if (requestId !== undefined) {
          if (requestId !== get().accountSummariesRequestId) return false;
          set({ accountSummaries: list, accountSummariesComplete: complete });
          return true;
        }
        // A direct mutation (optimistic create/delete, demo derivation or test setup) is newer than
        // every response already in flight, so advance the same sequence before publishing it.
        set((state) => ({
          accountSummaries: list,
          accountSummariesComplete: complete,
          accountSummariesRequestId: state.accountSummariesRequestId + 1,
        }));
        return true;
      },
    };
  };
}
