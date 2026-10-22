import { emptyAppData, SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { HISTORY_LIMIT } from "@/store/history";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import type { AppData, AppDataKey } from "@capacitylens/shared/types/entities";
import type {
  PlanningExecution,
  PlanningHistoryEntry,
  PlanningIntent,
  PlanningMutationLookup,
  PlanningMutationSuccess,
} from "@capacitylens/backend/planning";

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
}

export interface PlanningTransport {
  execute(
    context: PlanningClientContext,
    execution: PlanningExecution,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess>;
  read(context: PlanningClientContext, signal: AbortSignal): Promise<PlanningSnapshot>;
  lookup(context: PlanningClientContext, mutationId: string, signal: AbortSignal): Promise<PlanningMutationLookup>;
  /** The page-memory demo uses this when an imported company replaces its planning history. */
  resetAfterDemoImport?(companyId: string, data: AppData): number;
}

export interface PlanningHistory {
  past: PlanningHistoryEntry[];
  future: PlanningHistoryEntry[];
  /** Revision at the acknowledged history tip; metadata only, never a data snapshot. */
  tipRevision: number | null;
}

export type PlanningStatus = "idle" | "loading" | "ready" | "pending" | "refused" | "uncertain" | "error";

export type PlanningMutationOutcome =
  | { kind: "pending"; execution: PlanningExecution }
  | { kind: "acknowledged"; mutationId: string; revision: number }
  | { kind: "refused"; mutationId: string; code?: string }
  | { kind: "uncertain"; execution: PlanningExecution };

export interface PlanningPendingMutation {
  execution: PlanningExecution;
  inverse: PlanningIntent | null;
  historyEntry: PlanningHistoryEntry | null;
  originalWritable: unknown;
  kind: "new" | "undo" | "redo";
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
    (planning.status === "ready" || planning.status === "refused")
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
  readonly generation: number;
}

export interface PlanningControllerOptions {
  getState: PlanningCacheStore["getState"];
  setState: PlanningCacheStore["setState"];
  transport: PlanningTransport;
  createMutationId?: () => string;
}

export class PlanningControllerError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly uncertain: boolean;

  constructor(message: string, code?: string, status?: number, uncertain = false) {
    super(message);
    this.name = "PlanningControllerError";
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

const emptyHistory = (): PlanningHistory => ({ past: [], future: [], tipRevision: null });

const initialMetadata = (context: PlanningClientContext | null = null): PlanningControllerMetadata => ({
  context,
  accessKey: null,
  canWrite: false,
  revision: null,
  status: context ? "loading" : "idle",
  history: emptyHistory(),
  pending: null,
  outcome: null,
  error: null,
});

/** Creates the single non-persisted Zustand value used by the planning controller. */
export function createPlanningCacheState(data: AppData = emptyAppData()): PlanningCacheState {
  return { data, planning: initialMetadata() };
}

function cloneImmutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(cloned);
  return cloned;
}

function sameContext(left: PlanningClientContext | null, right: PlanningClientContext | null): boolean {
  return (
    left === right ||
    (!!left && !!right && left.companyId === right.companyId && Object.is(left.identity, right.identity))
  );
}

function errorDetails(error: unknown): { code?: string; status?: number; message: string } {
  if (error !== null && typeof error === "object") {
    const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
    return {
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
      ...(typeof candidate.status === "number"
        ? { status: candidate.status }
        : typeof candidate.statusCode === "number"
          ? { status: candidate.statusCode }
          : {}),
      message: typeof candidate.message === "string" ? candidate.message : "Planning request failed.",
    };
  }
  return { message: error instanceof Error ? error.message : "Planning request failed." };
}

/** True when the planning state already shows the outcome: the follow-up canonical read resolves a
 * stale revision, and a 403 refusal stays visible as refused. Callers add no notice for either. */
export function isShownByPlanningState(error: unknown): boolean {
  const { code, status } = errorDetails(error);
  return code === "stale_revision" || status === 409 || status === 403;
}

/** The planning notice to show: a 403 refusal keeps the rows (K2), and a failed read leaves them stale. */
export function readPlanningProblem(planning: PlanningControllerMetadata): "refused" | "unavailable" | null {
  if (planning.error === null) return null;
  if (errorDetails(planning.error).status === 403) return "refused";
  return planning.status === "error" ? "unavailable" : null;
}

function isValidSnapshot(snapshot: unknown): snapshot is PlanningSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.data)) return false;
  const data = snapshot.data;
  return (
    Number.isSafeInteger(snapshot.revision) &&
    typeof snapshot.revision === "number" &&
    snapshot.revision >= 0 &&
    Array.isArray(data.accounts) &&
    data.accounts.every(isRecord) &&
    SCOPED_KEYS.every((key) => Array.isArray(data[key])) &&
    SCOPED_KEYS.every((key) => (data[key] as unknown[]).every(isRecord)) &&
    (snapshot.accessKey === undefined || typeof snapshot.accessKey === "string") &&
    typeof snapshot.canWrite === "boolean"
  );
}

function isSnapshotForCompany(snapshot: PlanningSnapshot, companyId: string): boolean {
  return (
    snapshot.data.accounts.every((account) => isRecord(account) && account.id === companyId) &&
    SCOPED_KEYS.every((key) => snapshot.data[key].every((row) => isRecord(row) && row.accountId === companyId))
  );
}

function isProjectionForCompany(receipt: PlanningMutationSuccess, companyId: string): boolean {
  if (receipt.projection.mode !== "patch") return true;
  return receipt.projection.changed.upserts.every(({ entity, row }) =>
    entity === "accounts" ? row.id === companyId : "accountId" in row && row.accountId === companyId,
  );
}

function applyProjection(data: AppData, success: PlanningMutationSuccess): AppData {
  if (success.projection.mode !== "patch") return data;
  const next: AppData = { ...data };
  const mutable = next as unknown as Record<AppDataKey, Array<{ id: string }>>;
  const changedKeys = new Set<AppDataKey>();
  for (const item of success.projection.changed.upserts) changedKeys.add(item.entity);
  for (const item of success.projection.changed.removed) changedKeys.add(item.entity);
  for (const key of changedKeys) {
    const rows = [...data[key]] as unknown as Array<{ id: string }>;
    const changes = success.projection.changed;
    const removedIds = new Set(changes.removed.filter((item) => item.entity === key).map((item) => item.id));
    const upserts = changes.upserts.filter((item) => item.entity === key) as unknown as Array<{
      entity: AppDataKey;
      row: { id: string };
    }>;
    const byId = new Map(rows.filter((row) => !removedIds.has(row.id)).map((row) => [row.id, row]));
    for (const item of upserts) byId.set(item.row.id, item.row);
    mutable[key] = [...byId.values()];
  }
  return next;
}

function replaceRestoreHandle(intent: PlanningIntent, handle: string | undefined): PlanningIntent {
  if (intent.operation !== "planning.restoreGroup" || !handle) return intent;
  return { ...intent, restorationGroupId: handle };
}

function isValidReceipt(receipt: unknown, execution: PlanningExecution): receipt is PlanningMutationSuccess {
  if (!isRecord(receipt) || !isRecord(receipt.restoration) || !isRecord(receipt.projection)) return false;
  const restoration = receipt.restoration;
  const projection = receipt.projection;
  const changed = projection.changed;
  const validRestoration =
    (restoration.consumedGroupId === null || typeof restoration.consumedGroupId === "string") &&
    (restoration.replacementGroupId === null || typeof restoration.replacementGroupId === "string");
  const validProjection =
    (projection.mode === "refetch" && projection.history === "clear") ||
    (projection.mode === "patch" &&
      projection.history === "retain" &&
      isRecord(changed) &&
      Array.isArray(changed.upserts) &&
      Array.isArray(changed.removed));
  return (
    receipt.status === "committed" &&
    receipt.mutationId === execution.mutationId &&
    Number.isSafeInteger(receipt.revision) &&
    typeof receipt.revision === "number" &&
    receipt.revision === execution.baseRevision + 1 &&
    validRestoration &&
    validProjection
  );
}

// K2: only an ended session loses scope. Every 403, membership loss included, is a refusal that
// keeps the readable rows and history.
function losesScope(error: unknown): boolean {
  const details = errorDetails(error);
  return details.status === 401 || details.code === "unauthenticated";
}

function restoreIntent(handle: string): PlanningIntent {
  return { operation: "planning.restoreGroup", restorationGroupId: handle };
}

function isDeleteIntent(intent: PlanningIntent): boolean {
  return intent.operation.endsWith(".delete") || intent.operation.endsWith("deleteGroup");
}

function isLookupHistoryEligible(intent: PlanningIntent, inverse: PlanningIntent | null): boolean {
  if (!inverse) return false;
  return !(
    intent.operation === "catalogue.update" &&
    ("isPrivate" in intent.entity.changes ||
      "codeName" in intent.entity.changes ||
      (intent.entity.entity === "activities" && "kind" in intent.entity.changes))
  );
}

function movedHistory(
  history: PlanningHistory,
  kind: "new" | "undo" | "redo",
  entry: PlanningHistoryEntry | null,
  action: PlanningIntent,
  nextInverse: PlanningIntent | null,
  replacementHandle: string | undefined,
  revision: number,
): PlanningHistory {
  if (kind === "new") {
    if (!entry || !nextInverse) return emptyHistory();
    const inverse = replaceRestoreHandle(nextInverse, replacementHandle);
    if (inverse.operation === "planning.restoreGroup" && inverse.restorationGroupId === "") return emptyHistory();
    return {
      past: [...history.past, { forward: cloneImmutable(entry.forward), inverse }].slice(-HISTORY_LIMIT),
      future: [],
      tipRevision: revision,
    };
  }
  if (!entry) return emptyHistory();
  if (kind === "undo") {
    const remaining = history.past.slice(0, -1);
    let redo: PlanningHistoryEntry;
    if (action.operation === "planning.restoreGroup") {
      redo = cloneImmutable(entry);
    } else if (replacementHandle) {
      redo = { forward: restoreIntent(replacementHandle), inverse: cloneImmutable(action) };
    } else if (entry.forward.operation === "resource.create" && action.operation === "resource.archive") {
      redo = { forward: { operation: "resource.unarchive", id: action.id }, inverse: cloneImmutable(action) };
    } else if (entry.forward.operation === "catalogue.create" && action.operation === "catalogue.archive") {
      redo = {
        forward: { operation: "catalogue.unarchive", entity: action.entity },
        inverse: cloneImmutable(action),
      };
    } else if (isDeleteIntent(action) || entry.forward.operation === "planning.restoreGroup") {
      return emptyHistory();
    } else {
      redo = { forward: cloneImmutable(entry.forward), inverse: cloneImmutable(action) };
    }
    return { past: remaining, future: [...history.future, redo].slice(-HISTORY_LIMIT), tipRevision: revision };
  }
  const remaining = history.future.slice(0, -1);
  let past: PlanningHistoryEntry;
  if (action.operation === "planning.restoreGroup") {
    past = { forward: cloneImmutable(action), inverse: cloneImmutable(entry.inverse) };
  } else {
    const inverse = replaceRestoreHandle(entry.inverse, replacementHandle);
    if (inverse.operation === "planning.restoreGroup" && inverse.restorationGroupId === "") return emptyHistory();
    past = { forward: cloneImmutable(action), inverse };
  }
  return { past: [...history.past, past].slice(-HISTORY_LIMIT), future: remaining, tipRevision: revision };
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
    const frozenContext = context ? Object.freeze({ identity: context.identity, companyId: context.companyId }) : null;
    if (sameContext(store.getState().planning.context, frozenContext)) return;
    generation += 1;
    readSequence += 1;
    lookupSequence += 1;
    attempt = null;
    accessKeyEstablished = false;
    abortAll();
    store.setState(() => ({ data: emptyAppData(), planning: initialMetadata(frozenContext) }));
  }

  function invalidateAfterDemoImport(context: PlanningClientContext, revision: number): PlanningControllerMetadata {
    generation += 1;
    readSequence += 1;
    lookupSequence += 1;
    attempt = null;
    accessKeyEstablished = false;
    abortAll();
    return { ...initialMetadata(Object.freeze({ ...context })), revision, canWrite: true, status: "ready" };
  }

  function acceptRead(snapshot: PlanningSnapshot): boolean {
    const current = store.getState();
    const context = current.planning.context;
    if (!context || !isValidSnapshot(snapshot) || !isSnapshotForCompany(snapshot, context.companyId))
      throw new PlanningControllerError("The canonical planning read was invalid.");
    const accessChanged =
      (snapshot.accessKey !== undefined && accessKeyEstablished && snapshot.accessKey !== current.planning.accessKey) ||
      (current.planning.revision !== null && snapshot.canWrite !== current.planning.canWrite);
    const older = current.planning.revision !== null && snapshot.revision < current.planning.revision;
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
          status: older ? "error" : "ready",
          error: older ? new PlanningControllerError("The access projection changed but its read was stale.") : null,
        },
      }));
      return !older;
    }
    if (older) throw new PlanningControllerError("The canonical planning read was stale.");
    if (snapshot.accessKey !== undefined) accessKeyEstablished = true;

    const owner = attempt;
    const commitment = owner?.pending.commitment;
    const finalized = !!commitment && snapshot.revision >= commitment.revision;
    let history = current.planning.history;
    if (finalized) {
      const exact = snapshot.revision === commitment.revision;
      const restorationAvailable = !isDeleteIntent(owner.pending.execution.intent) || !!commitment.replacementHandle;
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
        status: finalized || !state.planning.pending ? "ready" : commitment ? "pending" : state.planning.status,
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
      planning: { ...state.planning, status: state.planning.pending ? state.planning.status : "loading", error: null },
    }));
    try {
      const snapshot = await transport.read(context, controller.signal);
      if (!isCurrent(capturedGeneration, context) || sequence !== readSequence) return false;
      return acceptRead(snapshot);
    } catch (error) {
      if (!isCurrent(capturedGeneration, context) || sequence !== readSequence || controller.signal.aborted)
        return false;
      if (losesScope(error)) {
        setContext(null);
        return false;
      }
      store.setState((state) => ({
        planning: { ...state.planning, status: "error", error },
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
    if (!state.planning.canWrite)
      throw new PlanningControllerError("This planning view is read-only.", "authorization_denied", 403);
    if (
      !context ||
      baseRevision === null ||
      state.planning.pending ||
      !["ready", "refused"].includes(state.planning.status)
    ) {
      throw new PlanningControllerError("Planning is not ready for a new change.");
    }
    const immutableContext = context;
    return Object.freeze({
      baseRevision,
      originalWritable: cloneImmutable(originalWritable),
      context: immutableContext,
      generation,
    });
  }

  function historyMatches(expected: PlanningHistory): boolean {
    const actual = store.getState().planning.history;
    return (
      actual.past === expected.past && actual.future === expected.future && actual.tipRevision === expected.tipRevision
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
      commitment: { revision, historyEligible, ...(replacementHandle ? { replacementHandle } : {}) },
    };
    const current = store.getState();
    const canPatch =
      receipt?.projection.mode === "patch" && current.planning.revision === owner.pending.execution.baseRevision;
    store.setState((state) => ({
      ...(canPatch ? { data: applyProjection(state.data, receipt) } : {}),
      planning: {
        ...state.planning,
        revision: canPatch ? revision : state.planning.revision,
        status: "pending",
        pending: owner.pending,
        outcome: { kind: "acknowledged", mutationId: owner.pending.execution.mutationId, revision },
        history: historyEligible ? state.planning.history : emptyHistory(),
        error: null,
      },
    }));
  }

  async function reconcilePending(): Promise<boolean> {
    const owner = attempt;
    if (!owner || !ownsAttempt(owner)) return false;
    if (owner.pending.commitment) return refresh();
    if (store.getState().planning.outcome?.kind !== "uncertain") return false;
    const sequence = ++lookupSequence;
    const controller = requestController();
    const currentLookup = () => ownsAttempt(owner) && sequence === lookupSequence && !controller.signal.aborted;
    try {
      const lookup = await transport.lookup(owner.draft.context, owner.pending.execution.mutationId, controller.signal);
      if (!currentLookup()) return false;
      if (lookup.mutationId !== owner.pending.execution.mutationId)
        throw new PlanningControllerError("The commitment lookup returned an invalid identity.");
      if (lookup.status === "unknown") return false;
      if (!Number.isSafeInteger(lookup.revision) || lookup.revision !== owner.pending.execution.baseRevision + 1)
        throw new PlanningControllerError("The commitment lookup returned an invalid revision.");
      acknowledge(
        owner,
        lookup.revision,
        isLookupHistoryEligible(owner.pending.execution.intent, owner.pending.inverse),
        lookup.restorationGroupId,
      );
      return await refresh();
    } catch (error) {
      if (!currentLookup()) return false;
      if (losesScope(error)) setContext(null);
      else
        store.setState((state) => ({
          planning: { ...state.planning, status: owner.pending.commitment ? "error" : "uncertain", error },
        }));
      return false;
    } finally {
      finishRequest(controller);
    }
  }

  async function perform(
    draft: PlanningDraft,
    intent: PlanningIntent,
    inverse: PlanningIntent | null,
    kind: "new" | "undo" | "redo",
    entry: PlanningHistoryEntry | null,
  ): Promise<PlanningMutationSuccess | null> {
    const state = store.getState();
    if (!isCurrent(draft.generation, draft.context) || state.planning.revision === null)
      throw new PlanningControllerError("Planning context changed before the change could be sent.");
    if (!state.planning.canWrite)
      throw new PlanningControllerError("This planning view is read-only.", "authorization_denied", 403);
    if (state.planning.pending) throw new PlanningControllerError("A planning change is already pending or uncertain.");
    if (state.planning.status !== "ready" && state.planning.status !== "refused")
      throw new PlanningControllerError("Planning is not ready for a new change.");
    const execution = cloneImmutable({ mutationId: createMutationId(), baseRevision: draft.baseRevision, intent });
    const immutableInverse = inverse ? cloneImmutable(inverse) : null;
    const pending: PlanningPendingMutation = {
      execution,
      inverse: immutableInverse,
      historyEntry: entry ? cloneImmutable(entry) : null,
      originalWritable: cloneImmutable(draft.originalWritable),
      kind,
    };
    const owner = { pending, history: state.planning.history, draft };
    attempt = owner;
    store.setState((current) => ({
      planning: {
        ...current.planning,
        status: "pending",
        pending,
        outcome: { kind: "pending", execution: pending.execution },
        error: null,
      },
    }));
    const controller = requestController();
    try {
      const receipt = await transport.execute(draft.context, execution, controller.signal);
      if (!ownsAttempt(owner))
        throw new PlanningControllerError("Planning context changed while the request was pending.");
      if (!isValidReceipt(receipt, execution) || !isProjectionForCompany(receipt, draft.context.companyId)) {
        store.setState((current) => ({
          planning: {
            ...current.planning,
            status: "uncertain",
            outcome: { kind: "uncertain", execution: pending.execution },
            error: new PlanningControllerError(
              "The server receipt was invalid; commitment is unknown.",
              undefined,
              undefined,
              true,
            ),
          },
        }));
        throw new PlanningControllerError(
          "The server receipt was invalid; commitment is unknown.",
          undefined,
          undefined,
          true,
        );
      }
      acknowledge(
        owner,
        receipt.revision,
        receipt.projection.mode === "patch" && isLookupHistoryEligible(intent, inverse),
        receipt.restoration.replacementGroupId ?? undefined,
        receipt,
      );
      await refresh();
      return isCurrent(draft.generation, draft.context) ? receipt : null;
    } catch (error) {
      const details = errorDetails(error);
      if (error instanceof PlanningControllerError && error.uncertain) throw error;
      if (losesScope(error)) {
        if (ownsAttempt(owner)) setContext(null);
        throw new PlanningControllerError(details.message, details.code, details.status);
      }
      if (details.code === "mutation_id_reused") {
        if (ownsAttempt(owner)) {
          store.setState((current) => ({
            planning: {
              ...current.planning,
              status: "uncertain",
              outcome: { kind: "uncertain", execution: pending.execution },
              error,
              pending,
            },
          }));
          await reconcilePending();
          if (owner.pending.commitment) return null;
        }
        throw new PlanningControllerError(details.message, details.code, details.status, true);
      }
      if (details.code === "stale_revision" || details.status === 409) {
        if (ownsAttempt(owner)) {
          attempt = null;
          store.setState((current) => ({
            planning: {
              ...current.planning,
              status: "refused",
              pending: null,
              outcome: { kind: "refused", mutationId: execution.mutationId, code: details.code ?? "stale_revision" },
              error,
              history:
                current.planning.revision !== null && current.planning.revision > draft.baseRevision
                  ? emptyHistory()
                  : current.planning.history,
            },
          }));
          await refresh();
        }
        throw new PlanningControllerError(details.message, details.code ?? "stale_revision", details.status);
      }
      if (
        details.status !== 408 &&
        (details.code === "authorization_denied" ||
          details.code === "validation_error" ||
          details.code === "no_change" ||
          (details.status !== undefined && details.status < 500))
      ) {
        if (ownsAttempt(owner)) {
          attempt = null;
          store.setState((current) => ({
            planning: {
              ...current.planning,
              status: "refused",
              pending: null,
              outcome: {
                kind: "refused",
                mutationId: execution.mutationId,
                ...(details.code ? { code: details.code } : {}),
              },
              error,
              history:
                current.planning.revision !== null && current.planning.revision > draft.baseRevision
                  ? emptyHistory()
                  : current.planning.history,
            },
          }));
        }
        throw new PlanningControllerError(details.message, details.code, details.status);
      }
      if (ownsAttempt(owner))
        store.setState((current) => ({
          planning: {
            ...current.planning,
            status: "uncertain",
            outcome: { kind: "uncertain", execution: pending.execution },
            pending,
            error,
          },
        }));
      throw new PlanningControllerError(details.message, details.code, details.status, true);
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
    const undo = inverse ? cloneImmutable(inverse) : null;
    return perform(draft, forward, undo, "new", undo ? { forward, inverse: undo } : null);
  }

  function historyDraft(kind: "undo" | "redo"): { draft: PlanningDraft; entry: PlanningHistoryEntry } | null {
    const state = store.getState();
    const history = state.planning.history;
    const entry = kind === "undo" ? history.past.at(-1) : history.future.at(-1);
    const targetIntent = kind === "undo" ? entry?.inverse : entry?.forward;
    if (
      !entry ||
      !targetIntent ||
      !state.planning.context ||
      !state.planning.canWrite ||
      state.planning.revision === null ||
      history.tipRevision !== state.planning.revision ||
      state.planning.pending ||
      !["ready", "refused"].includes(state.planning.status)
    )
      return null;
    const context = Object.freeze({ ...state.planning.context });
    return {
      entry,
      draft: Object.freeze({
        baseRevision: state.planning.revision,
        originalWritable: Object.freeze({}),
        context,
        generation,
      }),
    };
  }

  async function undo(): Promise<boolean> {
    const item = historyDraft("undo");
    if (!item) return false;
    await perform(item.draft, item.entry.inverse, item.entry.forward, "undo", item.entry);
    return isCurrent(item.draft.generation, item.draft.context);
  }

  async function redo(): Promise<boolean> {
    const item = historyDraft("redo");
    if (!item) return false;
    await perform(item.draft, item.entry.forward, item.entry.inverse, "redo", item.entry);
    return isCurrent(item.draft.generation, item.draft.context);
  }

  return { setContext, invalidateAfterDemoImport, refresh, begin, execute, reconcile: reconcilePending, undo, redo };
}
