import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { PlanningIntent } from "@capacitylens/backend/planning";
import { createPlanningCacheController, createPlanningCacheState } from "@/data/planning/planningCacheController";
import type {
  PlanningCacheState,
  PlanningClientContext,
  PlanningTransport,
} from "@/data/planning/planningCacheController";
import { createPlanningTransport } from "@/data/planning/planningTransport";

interface Harness {
  store: StoreApi<PlanningCacheState>;
  controller: ReturnType<typeof createPlanningCacheController>;
  transport: PlanningTransport;
  executions: Array<{ mutationId: string; baseRevision: number; intent: PlanningIntent }>;
  drafts: Map<string, ReturnType<ReturnType<typeof createPlanningCacheController>["begin"]>>;
  active: Promise<unknown> | null;
}

const harnesses = new Map<string, Harness>();

function requireHarness(key: string): Harness {
  const harness = harnesses.get(key);
  if (!harness) throw new Error(`Planning test harness '${key}' is not initialized.`);
  return harness;
}

function view(state: PlanningCacheState) {
  return {
    revision: state.planning.revision,
    status: state.planning.status,
    error: state.planning.error instanceof Error ? state.planning.error.message : null,
    history: {
      past: state.planning.history.past.length,
      future: state.planning.history.future.length,
      tipRevision: state.planning.history.tipRevision,
    },
    pending: state.planning.pending
      ? {
          mutationId: state.planning.pending.execution.mutationId,
          baseRevision: state.planning.pending.execution.baseRevision,
          operation: state.planning.pending.execution.intent.operation,
        }
      : null,
    outcome: state.planning.outcome?.kind ?? null,
    context: state.planning.context
      ? { companyId: state.planning.context.companyId, identity: String(state.planning.context.identity) }
      : null,
    allocations: state.data.allocations.map(({ id, startDate, endDate, resourceId, activityId, projectId }) => ({
      id,
      startDate,
      endDate,
      resourceId,
      activityId,
      projectId,
    })),
    resourceIds: state.data.resources.map(({ id }) => id),
    clientIds: state.data.clients.map(({ id }) => id),
    projectIds: state.data.projects.map(({ id }) => id),
    activityIds: state.data.activities.map(({ id }) => id),
  };
}

/** Creates a browser-only bridge for exercising the unactivated cache controller against the real API. */
export async function initializePlanningServerHarness(key: string, companyId: string) {
  const existing = harnesses.get(key);
  if (existing) throw new Error(`Planning test harness '${key}' already exists.`);

  const store = createStore<PlanningCacheState>()(() => createPlanningCacheState());
  const realTransport = createPlanningTransport();
  const executions: Harness["executions"] = [];
  const transport: PlanningTransport = {
    read: (context, signal) => realTransport.read(context, signal),
    lookup: (context, mutationId, signal) => realTransport.lookup(context, mutationId, signal),
    execute: (context, execution, signal) => {
      executions.push(execution);
      return realTransport.execute(context, execution, signal);
    },
  };
  const controller = createPlanningCacheController({ getState: store.getState, setState: store.setState, transport });
  const harness: Harness = { store, controller, transport, executions, drafts: new Map(), active: null };
  harnesses.set(key, harness);

  const context: PlanningClientContext = { identity: `browser-session:${key}`, companyId };
  controller.setContext(context);
  if (!(await controller.refresh())) throw new Error("The authenticated planning snapshot could not be loaded.");
  return view(store.getState());
}

export function planningHarnessState(key: string) {
  return view(requireHarness(key).store.getState());
}

export async function planningHarnessRefresh(key: string) {
  const harness = requireHarness(key);
  return { refreshed: await harness.controller.refresh(), state: view(harness.store.getState()) };
}

export async function planningHarnessExecute(
  key: string,
  intent: PlanningIntent,
  inverse: PlanningIntent | null = null,
) {
  const harness = requireHarness(key);
  const draft = harness.controller.begin({});
  const receipt = await harness.controller.execute(draft, intent, inverse);
  return { receipt, state: view(harness.store.getState()) };
}

export function planningHarnessStart(key: string, intent: PlanningIntent, inverse: PlanningIntent | null = null) {
  const harness = requireHarness(key);
  if (harness.active) throw new Error("A planning test request is already running.");
  const draft = harness.controller.begin({});
  const pending = harness.controller.execute(draft, intent, inverse);
  const execution = harness.store.getState().planning.pending?.execution;
  if (!execution) throw new Error("The planning request did not publish its pending state.");
  harness.active = pending.then(
    (receipt) => ({ kind: "resolved" as const, receipt }),
    (error: unknown) => ({
      kind: "rejected" as const,
      message: error instanceof Error ? error.message : String(error),
      code: error !== null && typeof error === "object" && "code" in error ? String(error.code) : undefined,
      status: error !== null && typeof error === "object" && "status" in error ? Number(error.status) : undefined,
    }),
  );
  return {
    mutationId: execution.mutationId,
    baseRevision: execution.baseRevision,
    state: view(harness.store.getState()),
  };
}

export async function planningHarnessFinish(key: string) {
  const harness = requireHarness(key);
  const active = harness.active;
  if (!active) throw new Error("No planning test request is running.");
  const result = await active;
  harness.active = null;
  return { result, state: view(harness.store.getState()) };
}

export function planningHarnessCaptureDraft(key: string, token: string) {
  const harness = requireHarness(key);
  const draft = harness.controller.begin({});
  harness.drafts.set(token, draft);
  return { baseRevision: draft.baseRevision };
}

export async function planningHarnessExecuteDraft(
  key: string,
  token: string,
  intent: PlanningIntent,
  inverse: PlanningIntent | null = null,
) {
  const harness = requireHarness(key);
  const draft = harness.drafts.get(token);
  if (!draft) throw new Error(`Planning draft '${token}' was not captured.`);
  try {
    const receipt = await harness.controller.execute(draft, intent, inverse);
    return { result: { kind: "resolved" as const, receipt }, state: view(harness.store.getState()) };
  } catch (error) {
    return {
      result: {
        kind: "rejected" as const,
        message: error instanceof Error ? error.message : String(error),
        code: error !== null && typeof error === "object" && "code" in error ? String(error.code) : undefined,
        status: error !== null && typeof error === "object" && "status" in error ? Number(error.status) : undefined,
      },
      state: view(harness.store.getState()),
    };
  }
}

export async function planningHarnessUndo(key: string) {
  const harness = requireHarness(key);
  const result = await harness.controller.undo();
  return { result, executions: harness.executions, state: view(harness.store.getState()) };
}

export async function planningHarnessRedo(key: string) {
  const harness = requireHarness(key);
  const result = await harness.controller.redo();
  return { result, executions: harness.executions, state: view(harness.store.getState()) };
}

export async function planningHarnessReconcile(key: string) {
  const harness = requireHarness(key);
  const result = await harness.controller.reconcile();
  return { result, executions: harness.executions, state: view(harness.store.getState()) };
}

export function planningHarnessExecutions(key: string) {
  return requireHarness(key).executions;
}

export async function planningHarnessSignOut(key: string) {
  const harness = requireHarness(key);
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const refreshed = await harness.controller.refresh();
  return { signOutStatus: response.status, refreshed, state: view(harness.store.getState()) };
}
