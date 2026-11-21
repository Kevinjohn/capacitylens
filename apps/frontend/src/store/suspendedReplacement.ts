import { readApiError } from '@/lib/readApiError';
import { useStore } from '@/store/useStore';

/**
 * How the page catches up after the server may have replaced company data. `refresh` reads the
 * canonical planning set again; `reload` keeps planning writes suspended until the page reloads.
 */
export type ReplacementRecovery = 'refresh' | 'reload';

/** One whole-company replacement request and how the page recovers from it. */
export interface SuspendedReplacementInput {
  /** Sends the replacement request once, after planning writes are suspended. */
  send: () => Promise<Response>;
  recovery: ReplacementRecovery;
  /**
   * Reads whether a committed response changed company data, without consuming its body. An
   * unchanged replacement resumes writes without a fresh read. Omitted means changed.
   */
  isChanged?: (response: Response) => Promise<boolean>;
}

/** Why a replacement's commit is unknown: a timeout or server failure status, or no response. */
export type UncertainReplacementFailure =
  | { kind: 'status'; status: number; message: string | undefined }
  | { kind: 'no-response'; cause: unknown };

/**
 * The result of {@link runSuspendedReplacement}. `reloadRequired` means planning writes stay
 * suspended and the page must reload before another change; otherwise writes have resumed.
 */
export type SuspendedReplacementOutcome =
  | { kind: 'blocked' }
  | { kind: 'departed' }
  | { kind: 'refused'; status: number; message: string | undefined }
  | { kind: 'committed'; response: Response; reloadRequired: boolean }
  | { kind: 'uncertain'; failure: UncertainReplacementFailure; reloadRequired: boolean };

// A timeout or intermediary failure cannot prove whether the dispatched write committed.
function isUncertainStatus(status: number): boolean {
  return status === 408 || status >= 500;
}

/**
 * Runs one whole-company replacement: checks that the planning view is settled, suspends planning
 * writes, sends the request and recovers the page from what the server reported.
 *
 * `blocked` means nothing was sent. `refused` means the server refused the request; writes have
 * resumed so the caller can show the message and allow a retry. `uncertain` means the request may
 * have committed: with `refresh` recovery a fresh read reconciles the page, and the outcome
 * requires a reload when that read fails. With `refresh` recovery, `departed` means the company or
 * planning context changed during the run and the result belongs to no visible page. With `reload`
 * recovery the page reload replaces every context, so the outcome is reported as it is.
 */
export async function runSuspendedReplacement({
  send,
  recovery,
  isChanged,
}: SuspendedReplacementInput): Promise<SuspendedReplacementOutcome> {
  if (!useStore.getState().planningReadyForReplacement()) return { kind: 'blocked' };
  const release = useStore.getState().suspendPlanningIntents();
  if (!release) return { kind: 'blocked' };
  const { activeCompanyId, planning } = useStore.getState();
  const planningContext = planning.context;
  const hasDeparted = () => {
    if (recovery === 'reload') return false;
    const state = useStore.getState();
    return state.activeCompanyId !== activeCompanyId || state.planning.context !== planningContext;
  };
  let held = false;
  const refresh = async (): Promise<boolean> => {
    // A rejected read is a failed read; the outcome then requires a reload, which the caller shows.
    const refreshed = await useStore
      .getState()
      .refreshPlanning({ fresh: true })
      .catch(() => false);
    held = !refreshed;
    return refreshed;
  };
  const settleUncertain = async (
    failure: UncertainReplacementFailure,
  ): Promise<SuspendedReplacementOutcome> => {
    if (hasDeparted()) return { kind: 'departed' };
    if (recovery === 'reload') {
      held = true;
      return { kind: 'uncertain', failure, reloadRequired: true };
    }
    const refreshed = await refresh();
    if (hasDeparted()) return { kind: 'departed' };
    return { kind: 'uncertain', failure, reloadRequired: !refreshed };
  };

  try {
    let response: Response;
    try {
      response = await send();
    } catch (cause) {
      // A missing response does not prove refusal; reconcile before permitting another replacement.
      return await settleUncertain({ kind: 'no-response', cause });
    }
    if (hasDeparted()) return { kind: 'departed' };
    if (response.ok) {
      if (recovery === 'reload') {
        held = true;
        return { kind: 'committed', response, reloadRequired: true };
      }
      const changed = isChanged ? await isChanged(response) : true;
      if (hasDeparted()) return { kind: 'departed' };
      if (!changed) return { kind: 'committed', response, reloadRequired: false };
      const refreshed = await refresh();
      if (hasDeparted()) return { kind: 'departed' };
      return { kind: 'committed', response, reloadRequired: !refreshed };
    }
    const message = await readApiError(response);
    if (isUncertainStatus(response.status)) {
      return await settleUncertain({ kind: 'status', status: response.status, message });
    }
    if (hasDeparted()) return { kind: 'departed' };
    return { kind: 'refused', status: response.status, message };
  } finally {
    if (!held) release();
  }
}
