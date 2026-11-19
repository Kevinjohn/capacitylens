import { getMasqueradeContextToken } from '@/api/masqueradeContext';
// Reuse the app's prebundled entry so loading this test module does not trigger a Vite dependency reload.
import { createStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { PlanningIntent } from '@/api/planningContracts';
import {
  createPlanningCacheController,
  createPlanningCacheState,
} from '@/data/planning/planningCacheController';
import type {
  PlanningCacheState,
  PlanningPhase,
  PlanningClientContext,
  PlanningTransport,
} from '@/data/planning/planningCacheTypes';
import { createPlanningTransport } from '@/data/planning/planningTransport';
import { readPlanningError } from '@/data/planning/planningNotices';

interface Harness {
  store: StoreApi<PlanningCacheState>;
  controller: ReturnType<typeof createPlanningCacheController>;
  transport: PlanningTransport;
  /** Every write, undo and redo the controller sent, in order. */
  executions: Array<{ mutationId: string; baseRevision: number; intent?: PlanningIntent }>;
  drafts: Map<string, ReturnType<ReturnType<typeof createPlanningCacheController>['begin']>>;
  active: Promise<unknown> | null;
}

const harnesses = new Map<string, Harness>();

function requireHarness(key: string): Harness {
  const harness = harnesses.get(key);
  if (!harness) throw new Error(`Planning test harness '${key}' is not initialized.`);
  return harness;
}

function readErrorMessage(phase: PlanningPhase): string | null {
  const error = readPlanningError(phase);
  return error instanceof Error ? error.message : null;
}

function view(state: PlanningCacheState) {
  return {
    revision: state.planning.revision,
    phase: state.planning.phase.kind,
    error: readErrorMessage(state.planning.phase),
    history: { ...state.planning.history },
    write:
      state.planning.phase.kind === 'writing'
        ? {
            mutationId: state.planning.phase.write.execution.mutationId,
            baseRevision: state.planning.phase.write.execution.baseRevision,
            operation:
              state.planning.phase.write.kind === 'new'
                ? state.planning.phase.write.execution.intent.operation
                : state.planning.phase.write.kind,
          }
        : null,
    lastWrite:
      'lastWrite' in state.planning.phase ? (state.planning.phase.lastWrite?.kind ?? null) : null,
    context: state.planning.context
      ? {
          companyId: state.planning.context.companyId,
          identity: String(state.planning.context.identity),
        }
      : null,
    allocations: state.data.allocations.map(
      ({ id, startDate, endDate, resourceId, activityId, projectId }) => ({
        id,
        startDate,
        endDate,
        resourceId,
        activityId,
        projectId,
      }),
    ),
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
  const executions: Harness['executions'] = [];
  const transport: PlanningTransport = {
    read: (context, signal, request) => realTransport.read(context, signal, request),
    execute: (context, execution, signal) => {
      executions.push(execution);
      return realTransport.execute(context, execution, signal);
    },
    undo: (context, step, signal) => {
      executions.push(step);
      return realTransport.undo(context, step, signal);
    },
    redo: (context, step, signal) => {
      executions.push(step);
      return realTransport.redo(context, step, signal);
    },
  };
  const controller = createPlanningCacheController({
    readMasqueradeContextToken: getMasqueradeContextToken,
    getState: store.getState,
    setState: store.setState,
    transport,
  });
  const harness: Harness = {
    store,
    controller,
    transport,
    executions,
    drafts: new Map(),
    active: null,
  };
  harnesses.set(key, harness);

  const context: PlanningClientContext = { identity: `browser-session:${key}`, companyId };
  controller.setContext(context);
  if (!(await controller.refresh())) {
    throw new Error('The authenticated planning snapshot could not be loaded.');
  }
  return view(store.getState());
}

export function planningHarnessState(key: string) {
  return view(requireHarness(key).store.getState());
}

export async function planningHarnessRefresh(key: string) {
  const harness = requireHarness(key);
  return { refreshed: await harness.controller.refresh(), state: view(harness.store.getState()) };
}

export async function planningHarnessExecute(key: string, intent: PlanningIntent) {
  const harness = requireHarness(key);
  const draft = harness.controller.begin();
  const receipt = await harness.controller.execute(draft, intent);
  return { receipt, state: view(harness.store.getState()) };
}

export function planningHarnessStart(key: string, intent: PlanningIntent) {
  const harness = requireHarness(key);
  if (harness.active) throw new Error('A planning test request is already running.');
  const draft = harness.controller.begin();
  const pending = harness.controller.execute(draft, intent);
  const { phase } = harness.store.getState().planning;
  const execution = phase.kind === 'writing' ? phase.write.execution : undefined;
  if (!execution) throw new Error('The planning request did not publish its pending state.');
  harness.active = pending.then(
    (receipt) => ({ kind: 'resolved' as const, receipt }),
    (error: unknown) => ({
      kind: 'rejected' as const,
      message: error instanceof Error ? error.message : String(error),
      code:
        error !== null && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : undefined,
      status:
        error !== null && typeof error === 'object' && 'status' in error
          ? Number(error.status)
          : undefined,
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
  if (!active) throw new Error('No planning test request is running.');
  const result = await active;
  harness.active = null;
  return { result, state: view(harness.store.getState()) };
}

export function planningHarnessCaptureDraft(key: string, token: string) {
  const harness = requireHarness(key);
  const draft = harness.controller.begin();
  harness.drafts.set(token, draft);
  return { baseRevision: draft.baseRevision };
}

export async function planningHarnessExecuteDraft(
  key: string,
  token: string,
  intent: PlanningIntent,
) {
  const harness = requireHarness(key);
  const draft = harness.drafts.get(token);
  if (!draft) throw new Error(`Planning draft '${token}' was not captured.`);
  try {
    const receipt = await harness.controller.execute(draft, intent);
    return {
      result: { kind: 'resolved' as const, receipt },
      state: view(harness.store.getState()),
    };
  } catch (error) {
    return {
      result: {
        kind: 'rejected' as const,
        message: error instanceof Error ? error.message : String(error),
        code:
          error !== null && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : undefined,
        status:
          error !== null && typeof error === 'object' && 'status' in error
            ? Number(error.status)
            : undefined,
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

export function planningHarnessExecutions(key: string) {
  return requireHarness(key).executions;
}

export async function planningHarnessSignOut(key: string) {
  const harness = requireHarness(key);
  const response = await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const refreshed = await harness.controller.refresh();
  return { signOutStatus: response.status, refreshed, state: view(harness.store.getState()) };
}
