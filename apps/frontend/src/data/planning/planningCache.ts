import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData } from '@capacitylens/shared/types/entities';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import type {
  PlanningCacheState,
  PlanningCacheStore,
  PlanningSessionScope,
  PlanningCacheMetadata,
  PlanningCacheOptions,
  PlanningDraft,
  PlanningHistory,
  PlanningPendingMutation,
  PlanningPhase,
  PlanningSnapshot,
  PlanningWriteResult,
} from './planningCacheTypes';
import { buildAccessKey, canWritePlanning } from './planningAccess';
import { getErrorDetails, PlanningCacheError } from './planningErrors';
import { isPlanningHistoryReady, isPlanningReadyForChange } from './planningReadiness';
import { isSnapshotForCompany, isValidReceipt, isValidSnapshot } from './planningReceipts';
import { applyReceiptChanges } from './planningReceiptChanges';

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

/** The last write a new or accepted read still reports: a refusal ends when the next read starts. */
function keptLastWrite(phase: PlanningPhase): PlanningWriteResult | null {
  if (phase.kind === 'idle' || phase.kind === 'writing') return null;
  return phase.lastWrite?.kind === 'refused' ? null : phase.lastWrite;
}

const initialMetadata = (context: PlanningSessionScope | null = null): PlanningCacheMetadata => ({
  context,
  authority: null,
  revision: null,
  today: null,
  capacity: null,
  phase: context ? { kind: 'loading', lastWrite: null } : { kind: 'idle' },
  history: buildEmptyHistory(),
});

/** Creates the single non-persisted Zustand value used by the planning cache. */
export function createPlanningCacheState(data: AppData = createEmptyAppData()): PlanningCacheState {
  return { data, planning: initialMetadata() };
}

function isSameContext(
  left: PlanningSessionScope | null,
  right: PlanningSessionScope | null,
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.companyId === right.companyId &&
      Object.is(left.identity, right.identity) &&
      left.masqueradeToken === right.masqueradeToken)
  );
}

// K2: only an ended session loses scope. Every 403, membership loss included, is a refusal that
// keeps the readable rows and history.
function isScopeLoss(error: unknown): boolean {
  const details = getErrorDetails(error);
  return details.status === 401;
}

/**
 * Owns one client's planning request ordering and the page's history id. The server holds the
 * history itself; the id lives only in memory, so a reload starts a new, empty history.
 */
export function createPlanningCache(options: PlanningCacheOptions) {
  const { transport } = options;
  const store: PlanningCacheStore = { getState: options.getState, setState: options.setState };
  const createMutationId = options.createMutationId ?? (() => crypto.randomUUID());
  const createHistoryId = options.createHistoryId ?? (() => crypto.randomUUID());
  // Replacing the id ends the page's history: the server never reports another id's steps.
  let historyId = createHistoryId();
  const withMasqueradeToken = (context: PlanningSessionScope): PlanningSessionScope =>
    context.masqueradeToken === undefined
      ? Object.freeze({ ...context, masqueradeToken: options.readMasqueradeToken() })
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

  const isAttemptOwner = (owner: NonNullable<typeof attempt>) => {
    const { phase } = store.getState().planning;
    return (
      attempt === owner &&
      isCurrent(owner.draft.generation, owner.draft.context) &&
      phase.kind === 'writing' &&
      phase.write.execution.mutationId === owner.pending.execution.mutationId
    );
  };
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
  const isCurrent = (capturedGeneration: number, context: PlanningSessionScope) =>
    generation === capturedGeneration && isSameContext(store.getState().planning.context, context);

  function setContext(context: PlanningSessionScope | null): void {
    const frozenContext = context
      ? Object.freeze({
          identity: context.identity,
          companyId: context.companyId,
          ...(context.masqueradeToken === undefined
            ? {}
            : { masqueradeToken: context.masqueradeToken }),
        })
      : null;
    if (isSameContext(store.getState().planning.context, frozenContext)) return;
    generation += 1;
    readSequence += 1;
    attempt = null;
    historyId = createHistoryId();
    abortAll();
    store.setState(() => ({
      data: createEmptyAppData(),
      planning: initialMetadata(frozenContext),
    }));
  }

  function loseScope(): void {
    setContext(null);
    options.onAuthLoss?.();
  }

  /** Accepts a read. Returns null for a reply without rows that the cache cannot stand on: its
   * revision is not the one held, or the reader's access changed. */
  function acceptRead(snapshot: PlanningSnapshot): boolean | null {
    const current = store.getState();
    const context = current.planning.context;
    if (
      !context ||
      !isValidSnapshot(snapshot) ||
      !isSnapshotForCompany(snapshot, context.companyId)
    ) {
      throw new PlanningCacheError('The canonical planning read was invalid.');
    }
    const accessChanged =
      current.planning.authority !== null &&
      buildAccessKey(snapshot.authority) !== buildAccessKey(current.planning.authority);
    if (
      snapshot.slice === 'unchanged' &&
      (accessChanged || snapshot.revision !== current.planning.revision)
    ) {
      return null;
    }
    const older =
      current.planning.revision !== null && snapshot.revision < current.planning.revision;
    if (accessChanged) {
      generation += 1;
      readSequence += 1;
      attempt = null;
      historyId = createHistoryId();
      abortAll();
      store.setState(() => ({
        data: older || snapshot.slice === 'unchanged' ? createEmptyAppData() : snapshot.data,
        planning: {
          ...initialMetadata(context),
          authority: older ? null : snapshot.authority,
          revision: older ? null : snapshot.revision,
          today: older ? null : snapshot.today,
          capacity: older ? null : snapshot.capacity,
          phase: older
            ? {
                kind: 'failed',
                error: new PlanningCacheError(
                  'The access projection changed but its read was stale.',
                ),
                lastWrite: null,
              }
            : { kind: 'ready', lastWrite: null },
        },
      }));
      return !older;
    }
    if (older) throw new PlanningCacheError('The canonical planning read was stale.');

    const commitment = attempt?.pending.commitment;
    // The read that reaches an acknowledged write's revision finalizes it.
    const acknowledged: PlanningWriteResult | null =
      attempt && commitment && snapshot.revision >= commitment.revision
        ? {
            kind: 'acknowledged',
            mutationId: attempt.pending.execution.mutationId,
            revision: commitment.revision,
          }
        : null;
    // The read is the only source of the page's undo and redo availability; none reported is none.
    const history = snapshot.history
      ? { canUndo: snapshot.history.canUndo, canRedo: snapshot.history.canRedo }
      : buildEmptyHistory();
    if (acknowledged) attempt = null;
    const phaseAfterRead = (phase: PlanningPhase): PlanningPhase => {
      if (acknowledged) return { kind: 'ready', lastWrite: acknowledged };
      // A write keeps waiting for its own read; this read's start already cleared any read error.
      if (phase.kind === 'writing') return phase;
      return { kind: 'ready', lastWrite: keptLastWrite(phase) };
    };
    store.setState((state) => ({
      // An unchanged read keeps the cached rows and their identities.
      ...(snapshot.slice === 'unchanged' ? {} : { data: snapshot.data }),
      planning: {
        ...state.planning,
        authority: snapshot.authority,
        revision: snapshot.revision,
        today: snapshot.today,
        capacity: snapshot.capacity,
        phase: phaseAfterRead(state.planning.phase),
        history,
      },
    }));
    return true;
  }

  /**
   * Reads the canonical snapshot. A quiet read from a settled state, such as the one that follows
   * a move of the capacity window, leaves a ready phase alone so writes stay allowed meanwhile. Any
   * other read shows as loading, except while a write is pending, when the phase stays writing.
   * A newer read aborts this one, and this one then resolves with the newer read's outcome.
   * A read names the revision the cache holds, unless `full` asks for the complete slice.
   */
  function refresh(readOptions: { quiet?: boolean; full?: boolean } = {}): Promise<boolean> {
    const read = readSnapshot(readOptions);
    latestRead = read;
    return read;
  }

  async function readSnapshot({
    quiet = false,
    full = false,
  }: {
    quiet?: boolean;
    full?: boolean;
  }): Promise<boolean> {
    const { context, revision } = store.getState().planning;
    if (!context) return false;
    const capturedGeneration = generation;
    const sequence = ++readSequence;
    readController?.abort();
    const controller = requestController();
    readController = controller;
    if (!quiet || store.getState().planning.phase.kind !== 'ready') {
      store.setState((state) => {
        const { phase } = state.planning;
        return {
          planning: {
            ...state.planning,
            phase:
              phase.kind === 'writing'
                ? { ...phase, readError: null }
                : { kind: 'loading', lastWrite: keptLastWrite(phase) },
          },
        };
      });
    }
    try {
      const window = options.readCapacityWindow?.();
      const snapshot = await transport.read(withMasqueradeToken(context), controller.signal, {
        ...(window ? { window } : {}),
        historyId,
        ...(full || revision === null ? {} : { ifRevision: revision }),
      });
      if (!isCurrent(capturedGeneration, context)) return false;
      if (sequence !== readSequence) return await (latestRead ?? false);
      // Rows the cache cannot stand on are never guessed at: read the complete slice once.
      return acceptRead(snapshot) ?? (await refresh({ quiet, full: true }));
    } catch (error) {
      if (!isCurrent(capturedGeneration, context)) return false;
      if (sequence !== readSequence) return await (latestRead ?? false);
      if (controller.signal.aborted) return false;
      if (isScopeLoss(error)) {
        loseScope();
        return false;
      }
      store.setState((state) => {
        const { phase } = state.planning;
        return {
          planning: {
            ...state.planning,
            phase:
              phase.kind === 'writing'
                ? { ...phase, readError: error }
                : { kind: 'failed', error, lastWrite: keptLastWrite(phase) },
          },
        };
      });
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
      throw new PlanningCacheError('This planning view is read-only.', 'AUTHORIZATION_DENIED', 403);
    }
    if (!context || baseRevision === null || !isPlanningReadyForChange(state.planning)) {
      throw new PlanningCacheError('Planning is not ready for a new change.');
    }
    const immutableContext = context;
    const requestContext = Object.freeze({
      ...immutableContext,
      masqueradeToken: options.readMasqueradeToken(),
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
        phase: { kind: 'writing', write: owner.pending, readError: null },
      },
    }));
  }

  function assertCanPerform(draft: PlanningDraft): void {
    const state = store.getState();
    if (!isCurrent(draft.generation, draft.context) || state.planning.revision === null) {
      throw new PlanningCacheError('Planning context changed before the change could be sent.');
    }
    if (!canWritePlanning(state.planning.authority)) {
      throw new PlanningCacheError('This planning view is read-only.', 'AUTHORIZATION_DENIED', 403);
    }
    if (state.planning.phase.kind === 'writing') {
      throw new PlanningCacheError('A planning change is already pending.');
    }
    if (!isPlanningReadyForChange(state.planning)) {
      throw new PlanningCacheError('Planning is not ready for a new change.');
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
        phase: { kind: 'writing', write: pending, readError: null },
      },
    }));
    return owner;
  }

  /** Sends the attempt, asking once to confirm restoration cleanup when the server requires it of
   * a new change. Returns DECLINED when the person declines, after restoring the planning state
   * from before. An undo or redo is never asked to confirm. */
  async function send(
    owner: NonNullable<typeof attempt>,
    before: PlanningCacheMetadata,
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
        !(error instanceof PlanningCacheError) ||
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
        throw new PlanningCacheError('Planning context changed before confirmation.');
      }
      if (!accepted) {
        attempt = null;
        store.setState((current) => ({
          planning:
            current.planning.revision === before.revision
              ? before
              : { ...current.planning, phase: { kind: 'ready', lastWrite: null } },
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
      throw new PlanningCacheError('Planning context changed while the request was pending.');
    }
    if (!isValidReceipt(receipt, pending.execution)) {
      await settleUnconfirmed(owner);
      throw new PlanningCacheError(
        'The server receipt was invalid; commitment is unknown.',
        undefined,
        undefined,
        true,
      );
    }
    acknowledge(owner, receipt.revision);
    // The receipt's rows apply only on top of the revision it was written against; otherwise the
    // read below differs in revision and returns the full slice.
    if (
      isCurrent(draft.generation, draft.context) &&
      store.getState().planning.revision === receipt.revision - 1
    ) {
      store.setState((state) => ({
        data: applyReceiptChanges(state.data, receipt.changes),
        planning: { ...state.planning, revision: receipt.revision },
      }));
    }
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
        phase: {
          kind: 'ready',
          lastWrite: {
            kind: 'refused',
            mutationId: owner.pending.execution.mutationId,
            ...(code ? { code } : {}),
            error,
          },
        },
      },
    }));
  }

  /**
   * A write whose reply was lost may or may not have committed. Show the server's state, clear undo
   * history and keep an `unconfirmed` last write so the person checks their change; never resend it.
   * A new history id is how the history clears: the server reports nothing for it yet.
   */
  async function settleUnconfirmed(owner: NonNullable<typeof attempt>): Promise<void> {
    attempt = null;
    historyId = createHistoryId();
    store.setState((current) => ({
      planning: {
        ...current.planning,
        phase: {
          kind: 'loading',
          lastWrite: { kind: 'unconfirmed', mutationId: owner.pending.execution.mutationId },
        },
        history: buildEmptyHistory(),
      },
    }));
    await refresh();
  }

  /** Records a failed send in planning state and rethrows it as a cache error. */
  async function settleFailure(owner: NonNullable<typeof attempt>, error: unknown): Promise<never> {
    const details = getErrorDetails(error);
    if (error instanceof PlanningCacheError && error.uncertain) throw error;
    if (isScopeLoss(error)) {
      if (isAttemptOwner(owner)) loseScope();
      throw new PlanningCacheError(details.message, details.code, details.status);
    }
    if (details.code === 'MUTATION_ID_REUSED') {
      if (isAttemptOwner(owner)) await settleUnconfirmed(owner);
      throw new PlanningCacheError(details.message, details.code, details.status, true);
    }
    if (details.code === 'STALE_REVISION' || details.status === 409) {
      if (isAttemptOwner(owner)) {
        markRefused(owner, error, details.code ?? 'STALE_REVISION');
        await refresh();
      }
      throw new PlanningCacheError(
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
      throw new PlanningCacheError(details.message, details.code, details.status);
    }
    if (isAttemptOwner(owner)) await settleUnconfirmed(owner);
    throw new PlanningCacheError(details.message, details.code, details.status, true);
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
      masqueradeToken: options.readMasqueradeToken(),
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
