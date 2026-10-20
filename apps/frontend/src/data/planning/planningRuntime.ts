import type { StoreApi } from "zustand";
import type { StoreState } from "@/store/types";
import { persistenceCoordinator } from "@/data/persistence/coordinator";
import { API_REQUEST_TIMEOUT_MS } from "@/data/requestTimeout";
import type { RefreshOutcome, FlushPendingWritesResult } from "@/data/persistence/facades";
import { resetSchedulerView } from "@/store/storeConstants";
import { readCurrentWeekAnchor } from "@/store/slices/schedulerSlice";
import { createPlanningCacheController, PlanningControllerError } from "./planningCacheController";
import type { PlanningTransport } from "./planningCacheController";

type Controller = ReturnType<typeof createPlanningCacheController>;
let activeController: Controller | null = null;
let writesAllowed: (() => boolean) | null = null;

/** The optional attachment distinguishes the temporary local demo from production boot. */
export function hasPlanningRuntime(): boolean {
  return activeController !== null;
}

/** External replacement operations suspend new planning attempts without queuing edits. */
export function assertPlanningWritesAllowed(): void {
  if (writesAllowed && !writesAllowed())
    throw new PlanningControllerError("Planning changes are suspended while company data is replaced.");
}

/** The controller attached by production boot; no browser write queue exists. */
export function getPlanningController(): Controller {
  if (!activeController) throw new PlanningControllerError("Planning has not finished starting.");
  return activeController;
}

/** Connects the single store value to authenticated company selection and browser refresh. */
export function attachPlanningRuntime(store: StoreApi<StoreState>, transport: PlanningTransport) {
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: (update) => store.setState((state) => update(state)),
    transport,
  });
  if (activeController) throw new Error("Planning is already attached.");
  activeController = controller;
  let disposed = false;
  let hydration: Promise<RefreshOutcome> = Promise.resolve({ kind: "skipped" });
  let suspensionCount = 0;
  writesAllowed = () => !disposed && suspensionCount === 0;
  let request: Promise<boolean> | null = null;
  const selectedProjection = (state: StoreState): string | null =>
    state.masquerade.kind === "active" || state.masquerade.kind === "ending"
      ? state.masquerade.state.accountId
      : state.activeAccountId;
  let selected = selectedProjection(store.getState());
  let access = store.getState().masquerade;
  let membershipRevision = store.getState().membershipRevision;
  let anchorPendingFor: string | null = null;

  async function refresh(id: string): Promise<Exclude<RefreshOutcome, { kind: "unattached" }>> {
    const context = store.getState().planning.context;
    const ownsProjection = () =>
      !disposed &&
      context !== null &&
      context.companyId === id &&
      context === store.getState().planning.context &&
      id === store.getState().activeAccountId;
    if (!ownsProjection()) return { kind: "skipped" };
    const pending = store.getState().planning.pending;
    const read = pending ? controller.reconcile() : controller.refresh();
    request = read;
    const accepted = await read;
    if (request === read) request = null;
    if (!ownsProjection()) return { kind: "skipped" };
    const state = store.getState();
    if (accepted && anchorPendingFor === id && state.data.accounts.some((account) => account.id === id)) {
      const anchor = readCurrentWeekAnchor(state.data, id);
      store.setState((current) => ({
        ui: { ...current.ui, ...anchor, recenterToken: current.ui.recenterToken + 1 },
      }));
      anchorPendingFor = null;
    }
    store.setState({
      activeAccountLoadFailed: accepted ? null : state.planning.revision === null ? id : state.activeAccountLoadFailed,
      connectionError: !accepted && state.planning.revision === null,
      persistError: !accepted,
    });
    return { kind: accepted ? "reloaded" : "failed" };
  }

  function select(id: string | null, anchorOnHydration = false): void {
    const state = store.getState();
    const verifiedProjection =
      id !== null &&
      (state.masquerade.kind === "active" || state.masquerade.kind === "ending") &&
      state.masquerade.state.accountId === id;
    if (verifiedProjection && state.activeAccountId !== id) {
      // An active server-verified masquerade may cold-start before its directory or company
      // rows are available. Admit only this verified projection; ordinary selection stays
      // behind setActiveAccount's known-company guard.
      store.setState((current) => ({
        activeAccountId: id,
        previousAccountId: null,
        activeAccountLoadFailed: null,
        past: [],
        future: [],
        notice: null,
        ui: resetSchedulerView(current.ui),
      }));
    }
    if (anchorOnHydration) anchorPendingFor = id;
    else if (anchorPendingFor !== id) anchorPendingFor = null;
    controller.setContext(id ? { identity: Symbol("planning access"), companyId: id } : null);
    store.setState({ past: [], future: [], activeAccountLoadFailed: null });
    store.setState({ hydrated: id === null });
    hydration = id
      ? refresh(id).finally(() => {
          if (!disposed && id === store.getState().activeAccountId) store.setState({ hydrated: true });
        })
      : Promise.resolve({ kind: "reloaded" });
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (disposed) return;
    if (previous.planning.context && !state.planning.context && state.activeAccountId !== null) {
      store.setState({
        activeAccountId: null,
        previousAccountId: null,
        accountSummaries: state.accountSummaries.filter(
          (account) => account.id !== previous.planning.context?.companyId,
        ),
        accountSummariesComplete: false,
        accountSummariesRequestId: state.accountSummariesRequestId + 1,
        activeRole: null,
        activeRoleStatus: "not-applicable",
      });
      return;
    }
    // A view-as transition is an access boundary even when the company stays selected.
    const nextSelected = selectedProjection(state);
    const selectionChanged = nextSelected !== selected;
    const changed = selectionChanged || state.masquerade !== access || state.membershipRevision !== membershipRevision;
    selected = nextSelected;
    access = state.masquerade;
    membershipRevision = state.membershipRevision;
    if (changed) {
      select(selected, selectionChanged);
      return;
    }
    const failed = state.planning.status === "error" || state.planning.status === "uncertain";
    if (state.persistError !== failed) store.setState({ persistError: failed });
  });

  async function waitForDispatchedChange(): Promise<void> {
    const state = store.getState().planning;
    if (!state.pending || state.status !== "pending") return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(deadline);
        unsubscribePending();
        resolve();
      };
      const unsubscribePending = store.subscribe((next) => {
        if (!next.planning.pending || next.planning.status !== "pending") finish();
      });
      // The API fetch has its own interactive deadline. A handoff never waits indefinitely
      // for a missing response and never dispatches another execution while this one is unresolved.
      const deadline = setTimeout(finish, API_REQUEST_TIMEOUT_MS + 1_000);
    });
  }

  const detachCoordinator = persistenceCoordinator.attach({
    hasUnsavedWrites: () => store.getState().planning.pending !== null,
    flushPending: async (): Promise<FlushPendingWritesResult> => {
      if (request) await request;
      await waitForDispatchedChange();
      if (!store.getState().planning.pending) return { kind: "clean" };
      await controller.reconcile();
      return store.getState().planning.pending ? { kind: "blocked" } : { kind: "clean" };
    },
    suspendWrites: () => {
      suspensionCount += 1;
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        suspensionCount -= 1;
      };
    },
    refreshActive: refresh,
    switchAndAwaitHydration: async (id) => {
      if (store.getState().planning.pending) return { kind: "skipped" };
      store.getState().setActiveAccount(id);
      return hydration;
    },
    retryActiveAccountLoad: refresh,
  });

  const refreshVisible = () => {
    const id = store.getState().activeAccountId;
    if (id && !request && document.visibilityState === "visible") void refresh(id);
  };
  window.addEventListener("focus", refreshVisible);
  window.addEventListener("online", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  const interval = setInterval(refreshVisible, 60_000);
  select(selected, selected !== null);

  return {
    controller,
    ready: () => hydration,
    canWrite: () => !disposed && suspensionCount === 0,
    dispose() {
      disposed = true;
      unsubscribe();
      detachCoordinator();
      clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      controller.setContext(null);
      if (activeController === controller) {
        activeController = null;
        writesAllowed = null;
      }
    },
  };
}
