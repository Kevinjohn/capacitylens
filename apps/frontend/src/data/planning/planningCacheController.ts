import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import type {
  PlanningCacheState,
  PlanningCacheStore,
  PlanningClientContext,
  PlanningControllerMetadata,
  PlanningControllerOptions,
  PlanningDraft,
  PlanningHistory,
  PlanningPendingMutation,
  PlanningSnapshot,
} from './planningCacheTypes';
import { buildAuthorityKey, canWritePlanning } from './planningAuthority';
import { errorDetails, PlanningControllerError } from './planningErrors';
import { isPlanningHistoryReady, isPlanningReadyForChange } from './planningReadiness';
import { isSnapshotForCompany, isValidReceipt, isValidSnapshot } from './planningReceipts';

// A declined restoration confirmation; distinct from any reply the transport can return.
const DECLINED = Symbol('declined');

/** Neither direction is available: the state before a read reports the page's history. */
const buildEmptyHistory = (): PlanningHistory => ({ canUndo: false, canRedo: false });

function cloneImmutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(cloned);
  return cloned;
}

/** A new change carries its intent; an undo or redo names only the page's server-held history. */
type AttemptRequest =
  | { kind: 'new'; intent: PlanningIntent; expectedUpdatedAt?: string; endsHistory: boolean }
  | { kind: 'undo' | 'redo' };

const initialMetadata = (
  context: PlanningClientContext | null = null,
): PlanningControllerMetadata => ({
  context,
  authority: null,
  revision: null,
  today: null,
  capacity: null,
  status: context ? 'loading' : 'idle',
  history: buildEmptyHistory(),
  pending: null,
  outcome: null,
  error: null,
});

/** Creates the single non-persisted Zustand value used by the planning controller. */
export function createPlanningCacheState(data: AppData = emptyAppData()): PlanningCacheState {
  return { data, planning: initialMetadata() };
}

function isSameContext(
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

// K2: only an ended session loses scope. Every 403, membership loss included, is a refusal that
// keeps the readable rows and history.
function isScopeLoss(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 401;
}

/**
 * Owns one client's planning request ordering and the page's history id. The server holds the
 * history itself; the id lives only in memory, so a reload starts a new, empty history.
 */
export function createPlanningCacheController(options: PlanningControllerOptions) {
  const { transport } = options;
  const store: PlanningCacheStore = { getState: options.getState, setState: options.setState };
  const createMutationId = options.createMutationId ?? (() => crypto.randomUUID());
  const createHistoryId = options.createHistoryId ?? (() => crypto.randomUUID());
  // Replacing the id ends the page's history: the server never reports another id's steps.
  let historyId = createHistoryId();
  const applyContextToken = (context: PlanningClientContext): PlanningClientContext =>
    context.masqueradeContextToken === undefined
      ? Object.freeze({ ...context, masqueradeContextToken: options.readMasqueradeContextToken() })
      : context;
  let generation = 0;
  let readSequence = 0;
  // The newest read: a read it supersedes is aborted and resolves with its outcome.
  let latestRead: Promise<boolean> | null = null;
  let readController: AbortController | null = null;
  let attempt: {
    pending: PlanningPendingMutation;
    draft: PlanningDraft;
  } | null = null;

  const isAttemptOwner = (owner: NonNullable<typeof attempt>) =>
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
    generation === capturedGeneration && isSameContext(store.getState().planning.context, context);

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
    if (isSameContext(store.getState().planning.context, frozenContext)) return;
    generation += 1;
    readSequence += 1;
    attempt = null;
    historyId = createHistoryId();
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
      current.planning.authority !== null &&
      buildAuthorityKey(snapshot.authority) !== buildAuthorityKey(current.planning.authority);
    const older =
      current.planning.revision !== null && snapshot.revision < current.planning.revision;
    if (accessChanged) {
      generation += 1;
      readSequence += 1;
      attempt = null;
      historyId = createHistoryId();
      abortAll();
      store.setState(() => ({
        data: older ? emptyAppData() : snapshot.data,
        planning: {
          ...initialMetadata(context),
          authority: older ? null : snapshot.authority,
          revision: older ? null : snapshot.revision,
          today: older ? null : snapshot.today,
          capacity: older ? null : snapshot.capacity,
          status: older ? 'error' : 'ready',
          error: older
            ? new PlanningControllerError('The access projection changed but its read was stale.')
            : null,
        },
      }));
      return !older;
    }
    if (older) throw new PlanningControllerError('The canonical planning read was stale.');

    const commitment = attempt?.pending.commitment;
    const finalized = !!commitment && snapshot.revision >= commitment.revision;
    // The read is the only source of the page's undo and redo availability; none reported is none.
    const history = snapshot.history
      ? { canUndo: snapshot.history.canUndo, canRedo: snapshot.history.canRedo }
      : buildEmptyHistory();
    if (finalized) {
      attempt = null;
    }
    store.setState((state) => ({
      data: snapshot.data,
      planning: {
        ...state.planning,
        authority: snapshot.authority,
        revision: snapshot.revision,
        today: snapshot.today,
        capacity: snapshot.capacity,
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

  /**
   * Reads the canonical snapshot. A quiet read from a settled state, such as the one that follows
   * a move of the capacity window, leaves the status alone so writes stay allowed meanwhile. Any
   * other read shows as loading, except while a write is pending, when the status stays pending.
   * A newer read aborts this one, and this one then resolves with the newer read's outcome.
   */
  function refresh(readOptions: { quiet?: boolean } = {}): Promise<boolean> {
    const read = readSnapshot(readOptions);
    latestRead = read;
    return read;
  }

  async function readSnapshot({ quiet = false }: { quiet?: boolean }): Promise<boolean> {
    const context = store.getState().planning.context;
    if (!context) return false;
    const capturedGeneration = generation;
    const sequence = ++readSequence;
    readController?.abort();
    const controller = requestController();
    readController = controller;
    const { status } = store.getState().planning;
    if (!quiet || (status !== 'ready' && status !== 'refused')) {
      store.setState((state) => ({
        planning: {
          ...state.planning,
          status: state.planning.pending ? state.planning.status : 'loading',
          error: null,
        },
      }));
    }
    try {
      const window = options.readCapacityWindow?.();
      const snapshot = await transport.read(applyContextToken(context), controller.signal, {
        ...(window ? { window } : {}),
        historyId,
      });
      if (!isCurrent(capturedGeneration, context)) return false;
      if (sequence !== readSequence) return await (latestRead ?? false);
      return acceptRead(snapshot);
    } catch (error) {
      if (!isCurrent(capturedGeneration, context)) return false;
      if (sequence !== readSequence) return await (latestRead ?? false);
      if (controller.signal.aborted) return false;
      if (isScopeLoss(error)) {
        loseScope();
        return false;
      }
      store.setState((state) => ({
        planning: { ...state.planning, status: 'error', error },
      }));
      return false;
    } finally {
      finishRequest(controller);
      if (readController === controller) readController = null;
    }
  }

  function begin(): PlanningDraft {
    const state = store.getState();
    const context = state.planning.context;
    const baseRevision = state.planning.revision;
    if (!canWritePlanning(state.planning.authority)) {
      throw new PlanningControllerError(
        'This planning view is read-only.',
        'AUTHORIZATION_DENIED',
        403,
      );
    }
    if (!context || baseRevision === null || !isPlanningReadyForChange(state.planning)) {
      throw new PlanningControllerError('Planning is not ready for a new change.');
    }
    const immutableContext = context;
    const requestContext = Object.freeze({
      ...immutableContext,
      masqueradeContextToken: options.readMasqueradeContextToken(),
    });
    return Object.freeze({
      baseRevision,
      context: immutableContext,
      requestContext,
      generation,
    });
  }

  function acknowledge(owner: NonNullable<typeof attempt>, revision: number): void {
    if (!isAttemptOwner(owner)) return;
    owner.pending = { ...owner.pending, commitment: { revision } };
    store.setState((state) => ({
      planning: {
        ...state.planning,
        status: 'pending',
        pending: owner.pending,
        outcome: { kind: 'acknowledged', mutationId: owner.pending.execution.mutationId, revision },
        error: null,
      },
    }));
  }

  function assertCanPerform(draft: PlanningDraft): void {
    const state = store.getState();
    if (!isCurrent(draft.generation, draft.context) || state.planning.revision === null) {
      throw new PlanningControllerError(
        'Planning context changed before the change could be sent.',
      );
    }
    if (!canWritePlanning(state.planning.authority)) {
      throw new PlanningControllerError(
        'This planning view is read-only.',
        'AUTHORIZATION_DENIED',
        403,
      );
    }
    if (state.planning.pending) {
      throw new PlanningControllerError('A planning change is already pending.');
    }
    if (!isPlanningReadyForChange(state.planning)) {
      throw new PlanningControllerError('Planning is not ready for a new change.');
    }
  }

  function startAttempt(
    draft: PlanningDraft,
    request: AttemptRequest,
  ): NonNullable<typeof attempt> {
    const identity = {
      mutationId: createMutationId(),
      baseRevision: draft.baseRevision,
      historyId,
    };
    const pending: PlanningPendingMutation =
      request.kind === 'new'
        ? {
            kind: 'new',
            execution: cloneImmutable({
              mutationId: identity.mutationId,
              baseRevision: identity.baseRevision,
              // A write that names no history ends the company's history on the server.
              ...(request.endsHistory ? {} : { historyId }),
              intent: request.intent,
              ...(request.expectedUpdatedAt === undefined
                ? {}
                : { expectedUpdatedAt: request.expectedUpdatedAt }),
            }),
          }
        : { kind: request.kind, execution: cloneImmutable(identity) };
    const owner = { pending, draft };
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

  /** Sends the attempt, asking once to confirm restoration cleanup when the server requires it of
   * a new change. Returns DECLINED when the person declines, after restoring the planning state
   * from before. An undo or redo is never asked to confirm. */
  async function send(
    owner: NonNullable<typeof attempt>,
    before: PlanningControllerMetadata,
    controller: AbortController,
  ): Promise<PlanningMutationSuccess | typeof DECLINED> {
    const { pending, draft } = owner;
    if (pending.kind !== 'new') {
      return transport[pending.kind](draft.requestContext, pending.execution, controller.signal);
    }
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
      if (!isAttemptOwner(owner) || controller.signal.aborted) throw error;
      const accepted = await options.confirmRestorationCleanup(
        error.restorableItemCount,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (!isAttemptOwner(owner)) {
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
  ): Promise<PlanningMutationSuccess | null> {
    const { pending, draft } = owner;
    if (!isAttemptOwner(owner)) {
      throw new PlanningControllerError('Planning context changed while the request was pending.');
    }
    if (!isValidReceipt(receipt, pending.execution)) {
      await settleUnconfirmed(owner);
      throw new PlanningControllerError(
        'The server receipt was invalid; commitment is unknown.',
        undefined,
        undefined,
        true,
      );
    }
    acknowledge(owner, receipt.revision);
    // The read after the commit is the only source of the page's undo and redo availability.
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
      },
    }));
  }

  /**
   * A write whose reply was lost may or may not have committed. Show the server's state, clear undo
   * history and keep an `unconfirmed` outcome so the person checks their change; never resend it.
   * A new history id is how the history clears: the server reports nothing for it yet.
   */
  async function settleUnconfirmed(owner: NonNullable<typeof attempt>): Promise<void> {
    attempt = null;
    historyId = createHistoryId();
    store.setState((current) => ({
      planning: {
        ...current.planning,
        status: 'loading',
        pending: null,
        outcome: { kind: 'unconfirmed', mutationId: owner.pending.execution.mutationId },
        error: null,
        history: buildEmptyHistory(),
      },
    }));
    await refresh();
  }

  /** Records a failed send in planning state and rethrows it as a controller error. */
  async function settleFailure(owner: NonNullable<typeof attempt>, error: unknown): Promise<never> {
    const details = errorDetails(error);
    if (error instanceof PlanningControllerError && error.uncertain) throw error;
    if (isScopeLoss(error)) {
      if (isAttemptOwner(owner)) loseScope();
      throw new PlanningControllerError(details.message, details.code, details.status);
    }
    if (details.code === 'MUTATION_ID_REUSED') {
      if (isAttemptOwner(owner)) await settleUnconfirmed(owner);
      throw new PlanningControllerError(details.message, details.code, details.status, true);
    }
    if (details.code === 'STALE_REVISION' || details.status === 409) {
      if (isAttemptOwner(owner)) {
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
      if (isAttemptOwner(owner)) {
        markRefused(owner, error, details.code);
        // A refused undo or redo ends the page's history on the server; the read shows that.
        if (owner.pending.kind !== 'new') await refresh();
      }
      throw new PlanningControllerError(details.message, details.code, details.status);
    }
    if (isAttemptOwner(owner)) await settleUnconfirmed(owner);
    throw new PlanningControllerError(details.message, details.code, details.status, true);
  }

  async function perform(
    draft: PlanningDraft,
    request: AttemptRequest,
  ): Promise<PlanningMutationSuccess | null> {
    assertCanPerform(draft);
    const before = store.getState().planning;
    const owner = startAttempt(draft, request);
    const controller = requestController();
    try {
      const receipt = await send(owner, before, controller);
      if (receipt === DECLINED) return null;
      return await acceptReceipt(owner, receipt);
    } catch (error) {
      return await settleFailure(owner, error);
    } finally {
      finishRequest(controller);
    }
  }

  /** Returns no receipt after context invalidation or a declined cleanup confirmation. An edit
   * form passes its row's opening `updatedAt`; Undo and Redo never send one. A change that ends the
   * history is sent without the page's history id, so it is not offered for undo. */
  async function execute(
    draft: PlanningDraft,
    intent: PlanningIntent,
    expectedUpdatedAt?: string,
    endsHistory = false,
  ): Promise<PlanningMutationSuccess | null> {
    return perform(draft, {
      kind: 'new',
      intent: cloneImmutable(intent),
      endsHistory,
      ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
    });
  }

  /** Asks the server to take one step through the page's history, when it reported one. */
  async function step(kind: 'undo' | 'redo'): Promise<boolean> {
    const state = store.getState();
    if (
      !state.planning.context ||
      state.planning.revision === null ||
      !isPlanningHistoryReady(state.planning, kind)
    ) {
      return false;
    }
    const context = Object.freeze({ ...state.planning.context });
    const requestContext = Object.freeze({
      ...context,
      masqueradeContextToken: options.readMasqueradeContextToken(),
    });
    const draft: PlanningDraft = Object.freeze({
      baseRevision: state.planning.revision,
      context,
      requestContext,
      generation,
    });
    await perform(draft, { kind });
    return isCurrent(draft.generation, draft.context);
  }

  return {
    setContext,
    refresh,
    begin,
    execute,
    undo: () => step('undo'),
    redo: () => step('redo'),
  };
}
