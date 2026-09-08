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

type AccountSliceCreator = StateCreator<StoreState, [], [], AccountSlice>;
type AccountSliceSet = Parameters<AccountSliceCreator>[0];
type AccountSliceGet = Parameters<AccountSliceCreator>[1];

interface AccountActionContext {
  internals: StoreInternals;
  set: AccountSliceSet;
  get: AccountSliceGet;
}

function createAddAccountAction({ internals, set }: AccountActionContext): StoreState["addAccount"] {
  const { createGuardedAction, assertWorkingDays, snapColor, mutate } = internals;
  return createGuardedAction((input: Draft<Account>): Account | null => {
    const timestamps = stamp();
    const weekStartsOn = input.weekStartsOn ?? 1;
    if (input.workingDays !== undefined) assertWorkingDays(input.workingDays);
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
    const internal = buildInternalClient(entity.id, timestamps.createdAt);
    mutate((data) => ({
      ...data,
      accounts: [...data.accounts, entity],
      clients: [...data.clients, internal],
    }));
    set((state) => ({
      accountSummariesRequestId: state.accountSummariesRequestId + 1,
      accountSummariesComplete: true,
      accountSummaries: state.accountSummaries.some((account) => account.id === entity.id)
        ? state.accountSummaries
        : [...state.accountSummaries, { id: entity.id, name: entity.name, role: "owner" as const }],
    }));
    return entity;
  }, null);
}

function createUpdateAccountAction({ internals, get }: AccountActionContext): StoreState["updateAccount"] {
  const { createGuardedAction, assertWorkingDays, mutate, updateById, applySnappedColor } = internals;
  return createGuardedAction((id: ID, patch: Patch<Account>) => {
    const state = get();
    const existing = state.data.accounts.find((account) => account.id === id);
    if (!existing) return;
    if (state.activeAccountId !== id) throw new Error("Cannot update a company other than the active company.");
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
  });
}

function createDeleteAccountAction({ internals, set, get }: AccountActionContext): StoreState["deleteAccount"] {
  return internals.createGuardedAction((id: ID) => {
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
        ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(data, null)),
      };
    });
  });
}

function resolveAccountSelection(rawId: ID | null, get: AccountSliceGet): { id: ID | null; unknown: boolean } {
  if (
    rawId === null ||
    get().data.accounts.some((account) => account.id === rawId) ||
    get().accountSummaries.some((account) => account.id === rawId)
  ) {
    return { id: rawId, unknown: false };
  }
  console.warn(`setActiveAccount: no company with id ${JSON.stringify(rawId)} — returning to the picker`);
  return { id: null, unknown: true };
}

function buildAccountNoticeTransition(switching: boolean, unknown: boolean): Partial<StoreState> {
  if (unknown) {
    return { notice: { message: m.notice_company_not_found(), tone: "error" } };
  }
  return switching ? { notice: null, ...buildClearedSession() } : {};
}

function createSetActiveAccountAction({ set, get }: AccountActionContext): StoreState["setActiveAccount"] {
  return (rawId) => {
    const { id, unknown } = resolveAccountSelection(rawId, get);
    set((state) => {
      const switching = id !== state.activeAccountId;
      return {
        activeAccountId: id,
        activeRole: switching && state.activeRole !== null ? "viewer" : state.activeRole,
        activeRoleStatus: switching && state.activeRole !== null ? "pending" : state.activeRoleStatus,
        previousAccountId: id === null ? state.activeAccountId : null,
        past: [],
        future: [],
        ...buildAccountNoticeTransition(switching, unknown),
        ui: resetSchedulerView(state.ui, readCurrentWeekAnchor(state.data, id)),
      };
    });
  };
}

function createSetAccountSummariesAction({ set, get }: AccountActionContext): StoreState["setAccountSummaries"] {
  return (list, requestId, complete = true) => {
    if (requestId !== undefined) {
      if (requestId !== get().accountSummariesRequestId) return false;
      set({ accountSummaries: list, accountSummariesComplete: complete });
      return true;
    }
    set((state) => ({
      accountSummaries: list,
      accountSummariesComplete: complete,
      accountSummariesRequestId: state.accountSummariesRequestId + 1,
    }));
    return true;
  };
}

export function createAccountSlice(internals: StoreInternals): StateCreator<StoreState, [], [], AccountSlice> {
  return (set, get) => {
    const context = { internals, set, get };
    return {
      data: emptyAppData(),
      activeAccountId: null,
      previousAccountId: null,
      accountSummaries: [],
      accountSummariesComplete: false,
      accountSummariesRequestId: 0,
      addAccount: createAddAccountAction(context),
      updateAccount: createUpdateAccountAction(context),
      deleteAccount: createDeleteAccountAction(context),
      setActiveAccount: createSetActiveAccountAction(context),

      // Plain transient state (NOT mutate): never on the undo/redo stack or in AppData/export.
      beginAccountSummariesRequest: () => {
        const requestId = get().accountSummariesRequestId + 1;
        set({ accountSummariesRequestId: requestId });
        return requestId;
      },
      setAccountSummaries: createSetAccountSummariesAction(context),
    };
  };
}
