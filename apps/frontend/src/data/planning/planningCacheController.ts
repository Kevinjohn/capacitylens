import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';
import type {
  PlanningExecution,
  PlanningHistoryEntry,
  PlanningIntent,
  PlanningMutationLookup,
  PlanningMutationSuccess,
} from '@/api/planningContracts';
import { getMasqueradeContextToken } from '@/auth/masqueradeContext';
import {
  cloneImmutable,
  emptyHistory,
  isDeleteIntent,
  isLookupHistoryEligible,
  movedHistory,
} from './planningHistory';
import {
  applyProjection,
  isProjectionForCompany,
  isSnapshotForCompany,
  isValidReceipt,
  isValidSnapshot,
} from './planningReceipts';

/** A canonical read normalized by the typed transport; its wire shape remains transport-owned. */
export interface PlanningSnapshot {
  revision: number;
  canWrite: boolean;
  data: AppData;
  /** Stable key produced by the typed transport from its verified authority projection. */
  accessKey?: string;
}

/** Client identity is deliberately opaque; company id distinguishes its planning projection. */
export interface PlanningClientContext {
  readonly identity: string | symbol;
  readonly companyId: string;
  /** Mode boundary captured when this planning context is installed. */
  readonly masqueradeContextToken?: string | null | undefined;
}

export interface PlanningTransport {
  execute(
    context: PlanningClientContext,
    execution: PlanningExecution,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess>;
  read(context: PlanningClientContext, signal: AbortSignal): Promise<PlanningSnapshot>;
  lookup(
    context: PlanningClientContext,
    mutationId: string,
    signal: AbortSignal,
  ): Promise<PlanningMutationLookup>;
}

export interface PlanningHistory {
  past: PlanningHistoryEntry[];
  future: PlanningHistoryEntry[];
  /** Revision at the acknowledged history tip; metadata only, never a data snapshot. */
  tipRevision: number | null;
}

export type PlanningStatus =
  'idle' | 'loading' | 'ready' | 'pending' | 'refused' | 'uncertain' | 'error';

export type PlanningMutationOutcome =
  | { kind: 'pending'; execution: PlanningExecution }
  | { kind: 'acknowledged'; mutationId: string; revision: number }
  | { kind: 'refused'; mutationId: string; code?: string }
  | { kind: 'uncertain'; execution: PlanningExecution };

export interface PlanningPendingMutation {
  execution: PlanningExecution;
  inverse: PlanningIntent | null;
  historyEntry: PlanningHistoryEntry | null;
  originalWritable: unknown;
  kind: 'new' | 'undo' | 'redo';
  /** Commitment is durable while the mandatory canonical read is pending or fails. */
  commitment?: { revision: number; historyEligible: boolean; replacementHandle?: string };
}

export interface PlanningControllerMetadata {
  context: PlanningClientContext | null;
  accessKey: string | null;
  canWrite: boolean;
  revision: number | null;
  status: PlanningStatus;
  history: PlanningHistory;
  pending: PlanningPendingMutation | null;
  outcome: PlanningMutationOutcome | null;
  error: unknown | null;
}

/** History controls use only the current acknowledged revision, with no unresolved write. */
export function isPlanningHistoryReady(planning: PlanningControllerMetadata): boolean {
  return (
    planning.context !== null &&
    planning.canWrite &&
    planning.revision !== null &&
    planning.history.tipRevision === planning.revision &&
    planning.pending === null &&
    (planning.status === 'ready' || planning.status === 'refused')
  );
}

/** The controller owns metadata; planning rows remain in the one Zustand `data` value. */
export interface PlanningCacheState {
  data: AppData;
  planning: PlanningControllerMetadata;
}

export interface PlanningCacheStore {
  getState(): PlanningCacheState;
  setState(update: (state: PlanningCacheState) => Partial<PlanningCacheState>): void;
}

export interface PlanningDraft {
  readonly baseRevision: number;
  /** The editable fields observed at gesture/form start, kept for the caller's rollback preview. */
  readonly originalWritable: unknown;
  readonly context: PlanningClientContext;
  /** Request proof frozen with the action; context changes never replace an admitted write's proof. */
  readonly requestContext: PlanningClientContext;
  readonly generation: number;
}

export interface PlanningControllerOptions {
  getState: PlanningCacheStore['getState'];
  setState: PlanningCacheStore['setState'];
  transport: PlanningTransport;
  createMutationId?: () => string;
  onAuthLoss?: () => void;
  confirmRestorationCleanup?: (count: number, signal: AbortSignal) => Promise<boolean>;
}

export class PlanningControllerError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly uncertain: boolean;
  readonly restorableItemCount: number | undefined;

  constructor(
    message: string,
    code?: string,
    status?: number,
    uncertain = false,
    restorableItemCount?: number,
  ) {
    super(message);
    this.name = 'PlanningControllerError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
    this.restorableItemCount = restorableItemCount;
  }
}

// A declined restoration confirmation; distinct from any reply the transport can return.
const DECLINED = Symbol('declined');

const initialMetadata = (
  context: PlanningClientContext | null = null,
): PlanningControllerMetadata => ({
  context,
  accessKey: null,
  canWrite: false,
  revision: null,
  status: context ? 'loading' : 'idle',
  history: emptyHistory(),
  pending: null,
  outcome: null,
  error: null,
});

/** Creates the single non-persisted Zustand value used by the planning controller. */
export function createPlanningCacheState(data: AppData = emptyAppData()): PlanningCacheState {
  return { data, planning: initialMetadata() };
}

function sameContext(
  left: PlanningClientContext | null,
  right: PlanningClientContext | null,
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.companyId === right.companyId &&
      Object.is(left.identity, right.identity) &&
      left.masqueradeContextToken === right.masqueradeContextToken)
  );
}

function errorDetails(error: unknown): { code?: string; status?: number; message: string } {
  if (error !== null && typeof error === 'object') {
    const candidate = error as {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      message?: unknown;
    };
    return {
      ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
      ...(typeof candidate.status === 'number'
        ? { status: candidate.status }
        : typeof candidate.statusCode === 'number'
          ? { status: candidate.statusCode }
          : {}),
      message:
        typeof candidate.message === 'string' ? candidate.message : 'Planning request failed.',
    };
  }
  return { message: error instanceof Error ? error.message : 'Planning request failed.' };
}

/** True when the planning state already shows the outcome: the follow-up canonical read resolves a
 * stale revision, and a 403 refusal stays visible as refused. Callers add no notice for either. */
export function isShownByPlanningState(error: unknown): boolean {
  const { code, status } = errorDetails(error);
  return code === 'STALE_REVISION' || status === 409 || status === 403;
}

/** The planning notice to show: a 403 refusal keeps the rows (K2), and a failed read leaves them stale. */
export function readPlanningProblem(
  planning: PlanningControllerMetadata,
): 'refused' | 'unavailable' | null {
  if (planning.error === null) return null;
  if (errorDetails(planning.error).status === 403) return 'refused';
  return planning.status === 'error' ? 'unavailable' : null;
}

// K2: only an ended session loses scope. Every 403, membership loss included, is a refusal that
// keeps the readable rows and history.
function losesScope(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 401;
}

/** Owns one client's planning request ordering and page-local typed history. */
export function createPlanningCacheController(options: PlanningControllerOptions) {
  const { transport } = options;
  const store: PlanningCacheStore = { getState: options.getState, setState: options.setState };
  const createMutationId = options.createMutationId ?? (() => crypto.randomUUID());
  let generation = 0;
  let readSequence = 0;
  let accessKeyEstablished = false;
  let lookupSequence = 0;
  let attempt: {
    pending: PlanningPendingMutation;
    history: PlanningHistory;
    draft: PlanningDraft;
  } | null = null;

  const ownsAttempt = (owner: NonNullable<typeof attempt>) =>
    attempt === owner &&
    isCurrent(owner.draft.generation, owner.draft.context) &&
    store.getState().planning.pending?.execution.mutationId === owner.pending.execution.mutationId;
  const controllers = new Set<AbortController>();

  const abortAll = () => {
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  const requestController = () => {
    const controller = new AbortController();
    controllers.add(controller);
    return controller;
  };
  const finishRequest = (controller: AbortController) => controllers.delete(controller);
  const isCurrent = (capturedGeneration: number, context: PlanningClientContext) =>
    generation === capturedGeneration && sameContext(store.getState().planning.context, context);

  function setContext(context: PlanningClientContext | null): void {
    const frozenContext = context
      ? Object.freeze({
          identity: context.identity,
          companyId: context.companyId,
          ...(context.masqueradeContextToken === undefined
            ? {}
            : { masqueradeContextToken: context.masqueradeContextToken }),
        })
      : null;
    if (sameContext(store.getState().planning.context, frozenContext)) return;
    generation += 1;
    readSequence += 1;
    lookupSequence += 1;
    attempt = null;
    accessKeyEstablished = false;
    abortAll();
    store.setState(() => ({ data: emptyAppData(), planning: initialMetadata(frozenContext) }));
  }

  function loseScope(): void {
    setContext(null);
    options.onAuthLoss?.();
  }

  function acceptRead(snapshot: PlanningSnapshot): boolean {
    const current = store.getState();
    const context = current.planning.context;
    if (
      !context ||
      !isValidSnapshot(snapshot) ||
      !isSnapshotForCompany(snapshot, context.companyId)
    ) {
      throw new PlanningControllerError('The canonical planning read was invalid.');
    }
    const accessChanged =
      (snapshot.accessKey !== undefined &&
        accessKeyEstablished &&
        snapshot.accessKey !== current.planning.accessKey) ||
      (current.planning.revision !== null && snapshot.canWrite !== current.planning.canWrite);
    const older =
      current.planning.revision !== null && snapshot.revision < current.planning.revision;
    if (accessChanged) {
      generation += 1;
      readSequence += 1;
      lookupSequence += 1;
      attempt = null;
      abortAll();
      accessKeyEstablished = true;
      store.setState(() => ({
        data: older ? emptyAppData() : snapshot.data,
        planning: {
          ...initialMetadata(context),
          accessKey: snapshot.accessKey ?? null,
          canWrite: !older && snapshot.canWrite,
          revision: older ? null : snapshot.revision,
          status: older ? 'error' : 'ready',
          error: older
            ? new PlanningControllerError('The access projection changed but its read was stale.')
            : null,
        },
      }));
      return !older;
    }
    if (older) throw new PlanningControllerError('The canonical planning read was stale.');
    if (snapshot.accessKey !== undefined) accessKeyEstablished = true;

    const owner = attempt;
    const commitment = owner?.pending.commitment;
    const finalized = !!commitment && snapshot.revision >= commitment.revision;
    let history = current.planning.history;
    if (finalized) {
      const exact = snapshot.revision === commitment.revision;
      const restorationAvailable =
        !isDeleteIntent(owner.pending.execution.intent) || !!commitment.replacementHandle;
      history =
        exact && commitment.historyEligible && restorationAvailable && historyMatches(owner.history)
          ? movedHistory(
              history,
              owner.pending.kind,
              owner.pending.historyEntry,
              owner.pending.execution.intent,
              owner.pending.inverse,
              commitment.replacementHandle,
              commitment.revision,
            )
          : emptyHistory();
    } else if (
      current.planning.revision !== null &&
      snapshot.revision > current.planning.revision &&
      !current.planning.pending
    ) {
      history = emptyHistory();
    }
    if (finalized) {
      attempt = null;
      lookupSequence += 1;
    }
    store.setState((state) => ({
      data: snapshot.data,
      planning: {
        ...state.planning,
        accessKey: snapshot.accessKey ?? state.planning.accessKey,
        canWrite: snapshot.canWrite,
        revision: snapshot.revision,
        status:
          finalized || !state.planning.pending
            ? 'ready'
            : commitment
              ? 'pending'
              : state.planning.status,
        pending: finalized ? null : state.planning.pending,
        error: null,
        history,
      },
    }));
    return true;
  }

  async function refresh(): Promise<boolean> {
    const context = store.getState().planning.context;
    if (!context) return false;
    const capturedGeneration = generation;
    const sequence = ++readSequence;
    const controller = requestController();
    store.setState((state) => ({
      planning: {
        ...state.planning,
        status: state.planning.pending ? state.planning.status : 'loading',
        error: null,
      },
    }));
    try {
      const snapshot = await transport.read(context, controller.signal);
      if (!isCurrent(capturedGeneration, context) || sequence !== readSequence) return false;
      return acceptRead(snapshot);
    } catch (error) {
      if (
        !isCurrent(capturedGeneration, context) ||
        sequence !== readSequence ||
        controller.signal.aborted
      ) {
        return false;
      }
      if (losesScope(error)) {
        loseScope();
        return false;
      }
      store.setState((state) => ({
        planning: { ...state.planning, status: 'error', error },
      }));
      return false;
    } finally {
      finishRequest(controller);
    }
  }

  function begin(originalWritable: unknown): PlanningDraft {
    const state = store.getState();
    const context = state.planning.context;
    const baseRevision = state.planning.revision;
    if (!state.planning.canWrite) {
      throw new PlanningControllerError(
        'This planning view is read-only.',
        'AUTHORIZATION_DENIED',
        403,
      );
    }
    if (
      !context ||
      baseRevision === null ||
      state.planning.pending ||
      !['ready', 'refused'].includes(state.planning.status)
    ) {
      throw new PlanningControllerError('Planning is not ready for a new change.');
    }
    const immutableContext = context;
    const requestContext = Object.freeze({
      ...immutableContext,
      masqueradeContextToken: getMasqueradeContextToken(),
    });
    return Object.freeze({
      baseRevision,
      originalWritable: cloneImmutable(originalWritable),
      context: immutableContext,
      requestContext,
      generation,
    });
  }

  function historyMatches(expected: PlanningHistory): boolean {
    const actual = store.getState().planning.history;
    return (
      actual.past === expected.past &&
      actual.future === expected.future &&
      actual.tipRevision === expected.tipRevision
    );
  }

  function acknowledge(
    owner: NonNullable<typeof attempt>,
    revision: number,
    historyEligible: boolean,
    replacementHandle?: string,
    receipt?: PlanningMutationSuccess,
  ): void {
    if (!ownsAttempt(owner)) return;
    owner.pending = {
      ...owner.pending,
      commitment: {
        revision,
        historyEligible,
        ...(replacementHandle ? { replacementHandle } : {}),
      },
    };
    const current = store.getState();
    const canPatch =
      receipt?.projection.mode === 'patch' &&
      current.planning.revision === owner.pending.execution.baseRevision;
    store.setState((state) => ({
      ...(canPatch ? { data: applyProjection(state.data, receipt) } : {}),
      planning: {
        ...state.planning,
        revision: canPatch ? revision : state.planning.revision,
        status: 'pending',
        pending: owner.pending,
        outcome: { kind: 'acknowledged', mutationId: owner.pending.execution.mutationId, revision },
        history: historyEligible ? state.planning.history : emptyHistory(),
        error: null,
      },
    }));
  }

  async function reconcilePending(): Promise<boolean> {
    const owner = attempt;
    if (!owner || !ownsAttempt(owner)) return false;
    if (owner.pending.commitment) return refresh();
    if (store.getState().planning.outcome?.kind !== 'uncertain') return false;
    const sequence = ++lookupSequence;
    const controller = requestController();
    const currentLookup = () =>
      ownsAttempt(owner) && sequence === lookupSequence && !controller.signal.aborted;
    try {
      const lookup = await transport.lookup(
        owner.draft.requestContext,
        owner.pending.execution.mutationId,
        controller.signal,
      );
      if (!currentLookup()) return false;
      if (lookup.mutationId !== owner.pending.execution.mutationId) {
        throw new PlanningControllerError('The commitment lookup returned an invalid identity.');
      }
      if (lookup.status === 'unknown') return false;
      if (
        !Number.isSafeInteger(lookup.revision) ||
        lookup.revision !== owner.pending.execution.baseRevision + 1
      ) {
        throw new PlanningControllerError('The commitment lookup returned an invalid revision.');
      }
      acknowledge(
        owner,
        lookup.revision,
        isLookupHistoryEligible(owner.pending.execution.intent, owner.pending.inverse),
        lookup.restorationGroupId,
      );
      return await refresh();
    } catch (error) {
      if (!currentLookup()) return false;
      if (losesScope(error)) loseScope();
      else {
        store.setState((state) => ({
          planning: {
            ...state.planning,
            status: owner.pending.commitment ? 'error' : 'uncertain',
            error,
          },
        }));
      }
      return false;
    } finally {
      finishRequest(controller);
    }
  }

  function assertCanPerform(draft: PlanningDraft): void {
    const state = store.getState();
    if (!isCurrent(draft.generation, draft.context) || state.planning.revision === null) {
      throw new PlanningControllerError(
        'Planning context changed before the change could be sent.',
      );
    }
    if (!state.planning.canWrite) {
      throw new PlanningControllerError(
        'This planning view is read-only.',
        'AUTHORIZATION_DENIED',
        403,
      );
    }
    if (state.planning.pending) {
      throw new PlanningControllerError('A planning change is already pending or uncertain.');
    }
    if (state.planning.status !== 'ready' && state.planning.status !== 'refused') {
      throw new PlanningControllerError('Planning is not ready for a new change.');
    }
  }

  function startAttempt(
    draft: PlanningDraft,
    intent: PlanningIntent,
    inverse: PlanningIntent | null,
    kind: 'new' | 'undo' | 'redo',
    entry: PlanningHistoryEntry | null,
  ): NonNullable<typeof attempt> {
    const pending: PlanningPendingMutation = {
      execution: cloneImmutable({
        mutationId: createMutationId(),
        baseRevision: draft.baseRevision,
        intent,
      }),
      inverse: inverse ? cloneImmutable(inverse) : null,
      historyEntry: entry ? cloneImmutable(entry) : null,
      originalWritable: cloneImmutable(draft.originalWritable),
      kind,
    };
    const owner = { pending, history: store.getState().planning.history, draft };
    attempt = owner;
    store.setState((current) => ({
      planning: {
        ...current.planning,
        status: 'pending',
        pending,
        outcome: { kind: 'pending', execution: pending.execution },
        error: null,
      },
    }));
    return owner;
  }

  /** Sends the attempt, asking once to confirm restoration cleanup when the server requires it.
   * Returns DECLINED when the person declines, after restoring the planning state from before. */
  async function send(
    owner: NonNullable<typeof attempt>,
    before: PlanningControllerMetadata,
    controller: AbortController,
  ): Promise<PlanningMutationSuccess | typeof DECLINED> {
    const { pending, draft } = owner;
    try {
      return await transport.execute(draft.requestContext, pending.execution, controller.signal);
    } catch (error) {
      if (
        !(error instanceof PlanningControllerError) ||
        error.code !== 'RESTORATION_CONFIRMATION_REQUIRED' ||
        !Number.isSafeInteger(error.restorableItemCount) ||
        error.restorableItemCount === undefined ||
        error.restorableItemCount <= 0 ||
        !options.confirmRestorationCleanup
      ) {
        throw error;
      }
      if (!ownsAttempt(owner) || controller.signal.aborted) throw error;
      const accepted = await options.confirmRestorationCleanup(
        error.restorableItemCount,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (!ownsAttempt(owner)) {
        throw new PlanningControllerError('Planning context changed before confirmation.');
      }
      if (!accepted) {
        attempt = null;
        store.setState((current) => ({
          planning:
            current.planning.revision === before.revision
              ? before
              : {
                  ...current.planning,
                  status: 'ready',
                  pending: null,
                  outcome: null,
                  error: null,
                  history: emptyHistory(),
                },
        }));
        return DECLINED;
      }
      pending.execution = cloneImmutable({
        ...pending.execution,
        confirmedRestorationCount: error.restorableItemCount,
      });
      return transport.execute(draft.requestContext, pending.execution, controller.signal);
    }
  }

  async function acceptReceipt(
    owner: NonNullable<typeof attempt>,
    receipt: PlanningMutationSuccess,
    intent: PlanningIntent,
    inverse: PlanningIntent | null,
  ): Promise<PlanningMutationSuccess | null> {
    const { pending, draft } = owner;
    if (!ownsAttempt(owner)) {
      throw new PlanningControllerError('Planning context changed while the request was pending.');
    }
    if (
      !isValidReceipt(receipt, pending.execution) ||
      !isProjectionForCompany(receipt, draft.context.companyId)
    ) {
      store.setState((current) => ({
        planning: {
          ...current.planning,
          status: 'uncertain',
          outcome: { kind: 'uncertain', execution: pending.execution },
          error: new PlanningControllerError(
            'The server receipt was invalid; commitment is unknown.',
            undefined,
            undefined,
            true,
          ),
        },
      }));
      throw new PlanningControllerError(
        'The server receipt was invalid; commitment is unknown.',
        undefined,
        undefined,
        true,
      );
    }
    acknowledge(
      owner,
      receipt.revision,
      receipt.projection.mode === 'patch' && isLookupHistoryEligible(intent, inverse),
      receipt.restoration.replacementGroupId ?? undefined,
      receipt,
    );
    await refresh();
    return isCurrent(draft.generation, draft.context) ? receipt : null;
  }

  function markRefused(
    owner: NonNullable<typeof attempt>,
    error: unknown,
    code: string | undefined,
  ): void {
    attempt = null;
    store.setState((current) => ({
      planning: {
        ...current.planning,
        status: 'refused',
        pending: null,
        outcome: {
          kind: 'refused',
          mutationId: owner.pending.execution.mutationId,
          ...(code ? { code } : {}),
        },
        error,
        history:
          current.planning.revision !== null && current.planning.revision > owner.draft.baseRevision
            ? emptyHistory()
            : current.planning.history,
      },
    }));
  }

  function markUncertain(owner: NonNullable<typeof attempt>, error: unknown): void {
    const { pending } = owner;
    store.setState((current) => ({
      planning: {
        ...current.planning,
        status: 'uncertain',
        outcome: { kind: 'uncertain', execution: pending.execution },
        error,
        pending,
      },
    }));
  }

  /** Records a failed send in planning state and rethrows it as a controller error. Returns null
   * only when a reused mutation id reconciles to a commitment. */
  async function settleFailure(owner: NonNullable<typeof attempt>, error: unknown): Promise<null> {
    const details = errorDetails(error);
    if (error instanceof PlanningControllerError && error.uncertain) throw error;
    if (losesScope(error)) {
      if (ownsAttempt(owner)) loseScope();
      throw new PlanningControllerError(details.message, details.code, details.status);
    }
    if (details.code === 'MUTATION_ID_REUSED') {
      if (ownsAttempt(owner)) {
        markUncertain(owner, error);
        await reconcilePending();
        if (owner.pending.commitment) return null;
      }
      throw new PlanningControllerError(details.message, details.code, details.status, true);
    }
    if (details.code === 'STALE_REVISION' || details.status === 409) {
      if (ownsAttempt(owner)) {
        markRefused(owner, error, details.code ?? 'STALE_REVISION');
        await refresh();
      }
      throw new PlanningControllerError(
        details.message,
        details.code ?? 'STALE_REVISION',
        details.status,
      );
    }
    if (
      details.status !== 408 &&
      (details.code === 'AUTHORIZATION_DENIED' ||
        details.code === 'VALIDATION_ERROR' ||
        details.code === 'NO_CHANGE' ||
        (details.status !== undefined && details.status < 500))
    ) {
      if (ownsAttempt(owner)) markRefused(owner, error, details.code);
      throw new PlanningControllerError(details.message, details.code, details.status);
    }
    if (ownsAttempt(owner)) markUncertain(owner, error);
    throw new PlanningControllerError(details.message, details.code, details.status, true);
  }

  async function perform(
    draft: PlanningDraft,
    intent: PlanningIntent,
    inverse: PlanningIntent | null,
    kind: 'new' | 'undo' | 'redo',
    entry: PlanningHistoryEntry | null,
  ): Promise<PlanningMutationSuccess | null> {
    assertCanPerform(draft);
    const before = store.getState().planning;
    const owner = startAttempt(draft, intent, inverse, kind, entry);
    const controller = requestController();
    try {
      const receipt = await send(owner, before, controller);
      if (receipt === DECLINED) return null;
      return await acceptReceipt(owner, receipt, intent, inverse);
    } catch (error) {
      return await settleFailure(owner, error);
    } finally {
      finishRequest(controller);
    }
  }

  /** Returns no receipt after context invalidation or commitment-only reconciliation; neither permits replay. */
  async function execute(
    draft: PlanningDraft,
    intent: PlanningIntent,
    inverse: PlanningIntent | null,
  ): Promise<PlanningMutationSuccess | null> {
    const forward = cloneImmutable(intent);
    const undoIntent = inverse ? cloneImmutable(inverse) : null;
    return perform(
      draft,
      forward,
      undoIntent,
      'new',
      undoIntent ? { forward, inverse: undoIntent } : null,
    );
  }

  function historyDraft(
    kind: 'undo' | 'redo',
  ): { draft: PlanningDraft; entry: PlanningHistoryEntry } | null {
    const state = store.getState();
    const history = state.planning.history;
    const entry = kind === 'undo' ? history.past.at(-1) : history.future.at(-1);
    const targetIntent = kind === 'undo' ? entry?.inverse : entry?.forward;
    if (
      !entry ||
      !targetIntent ||
      !state.planning.context ||
      !state.planning.canWrite ||
      state.planning.revision === null ||
      history.tipRevision !== state.planning.revision ||
      state.planning.pending ||
      !['ready', 'refused'].includes(state.planning.status)
    ) {
      return null;
    }
    const context = Object.freeze({ ...state.planning.context });
    const requestContext = Object.freeze({
      ...context,
      masqueradeContextToken: getMasqueradeContextToken(),
    });
    return {
      entry,
      draft: Object.freeze({
        baseRevision: state.planning.revision,
        originalWritable: Object.freeze({}),
        context,
        requestContext,
        generation,
      }),
    };
  }

  async function undo(): Promise<boolean> {
    const item = historyDraft('undo');
    if (!item) return false;
    await perform(item.draft, item.entry.inverse, item.entry.forward, 'undo', item.entry);
    return isCurrent(item.draft.generation, item.draft.context);
  }

  async function redo(): Promise<boolean> {
    const item = historyDraft('redo');
    if (!item) return false;
    await perform(item.draft, item.entry.forward, item.entry.inverse, 'redo', item.entry);
    return isCurrent(item.draft.generation, item.draft.context);
  }

  return {
    setContext,
    refresh,
    begin,
    execute,
    reconcile: reconcilePending,
    undo,
    redo,
  };
}
