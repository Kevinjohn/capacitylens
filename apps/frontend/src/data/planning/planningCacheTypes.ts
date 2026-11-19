import type { CapacityRange, CapacitySection } from '@capacitylens/shared/lib/capacity';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import type {
  PlanningAuthority,
  PlanningExecution,
  PlanningMutationSuccess,
} from '@/api/planningContracts';

export type { PlanningAuthority };

/** A canonical read normalized by the typed transport; its wire shape remains transport-owned. */
export interface PlanningSnapshot {
  revision: number;
  /** Who the read was for, and what that member may do and see, as the server verified it. */
  authority: PlanningAuthority;
  data: AppData;
  /** The company's calendar date, resolved by the server in the company time zone. */
  today: ISODate;
  /** The server's per-day capacity figures for the requested window and the overview horizon. */
  capacity: CapacitySection;
  /** Whether the reading page's server-held history can step back or forward; absent means neither. */
  history?: PlanningHistory;
}

/** What a planning read asks for: the capacity window, absent for the server's default, and the
 * page's history id, so the server reports that history's undo and redo availability. The planning
 * controller always names its history; a read outside it names none and is told neither is available. */
export interface PlanningReadRequest {
  window?: CapacityRange;
  historyId?: string;
}

/** One undo or redo of the page's server-held history; the server holds the intent it applies. */
export interface PlanningHistoryStep {
  mutationId: string;
  baseRevision: number;
  historyId: string;
}

/** Client identity is deliberately opaque; company id distinguishes its planning projection. */
export interface PlanningClientContext {
  readonly identity: string | symbol;
  readonly companyId: string;
  /** Mode boundary captured when this planning context is installed. */
  readonly masqueradeContextToken?: string | null | undefined;
}

/**
 * The server port. Error contract: the controller reads any thrown value for `code`, `status` and
 * `message` only. On `execute`, status 401 ends the planning scope; code `MUTATION_ID_REUSED`, status
 * 408, a status of 500 or more, or no status (a network failure) leaves the commit boundary unknown,
 * so the controller refetches and reports the change as unconfirmed; code `STALE_REVISION`
 * or status 409 is refused and refreshed; codes `AUTHORIZATION_DENIED`, `VALIDATION_ERROR` and
 * `NO_CHANGE`, and any other status below 500, are refused. Only a server request to confirm cleanup
 * must be a `PlanningControllerError`: code `RESTORATION_CONFIRMATION_REQUIRED` with a positive
 * `restorableItemCount`. A transport must not set `uncertain`; the controller sets it on failures it
 * has already recorded. `undo` and `redo` follow the same contract, except that the server never
 * asks them to confirm cleanup. A `read` failure ends the scope on 401 and is otherwise recorded
 * on the planning state.
 */
export interface PlanningTransport {
  execute(
    context: PlanningClientContext,
    execution: PlanningExecution,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess>;
  undo(
    context: PlanningClientContext,
    step: PlanningHistoryStep,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess>;
  redo(
    context: PlanningClientContext,
    step: PlanningHistoryStep,
    signal: AbortSignal,
  ): Promise<PlanningMutationSuccess>;
  read(
    context: PlanningClientContext,
    signal: AbortSignal,
    request?: PlanningReadRequest,
  ): Promise<PlanningSnapshot>;
}

/** Undo and redo availability for this page, as the server last reported it. */
export interface PlanningHistory {
  canUndo: boolean;
  canRedo: boolean;
}

/** What became of the page's last write, while later states still report it. */
export type PlanningWriteResult =
  | { kind: 'acknowledged'; mutationId: string; revision: number }
  | { kind: 'refused'; mutationId: string; code?: string; error: unknown }
  | { kind: 'unconfirmed'; mutationId: string };

export type PlanningPendingMutation = (
  | { kind: 'new'; execution: PlanningExecution }
  | { kind: 'undo' | 'redo'; execution: PlanningHistoryStep }
) & {
  /** Commitment is durable while the mandatory canonical read is pending or fails. */
  commitment?: { revision: number };
};

/**
 * The one planning state machine. `idle` has no context; `loading` has a read in flight and no
 * write; `ready` can take a change; `failed` is a read failure with no write; `writing` has a write
 * in flight or awaiting its canonical read. A refusal is `ready` with a `refused` last write until
 * the next read starts or is accepted; an acknowledged or unconfirmed last write lasts until the
 * next write.
 */
export type PlanningPhase =
  | { kind: 'idle' }
  | { kind: 'loading'; lastWrite: PlanningWriteResult | null }
  | { kind: 'ready'; lastWrite: PlanningWriteResult | null }
  | { kind: 'failed'; error: unknown; lastWrite: PlanningWriteResult | null }
  | { kind: 'writing'; write: PlanningPendingMutation; readError: unknown | null };

export interface PlanningControllerMetadata {
  context: PlanningClientContext | null;
  /** The authority of the last accepted read; null until a read is accepted. */
  authority: PlanningAuthority | null;
  revision: number | null;
  /** The company's calendar date from the last accepted read; null until a read is accepted. */
  today: ISODate | null;
  /** The capacity figures from the last accepted read; null until a read is accepted. */
  capacity: CapacitySection | null;
  phase: PlanningPhase;
  history: PlanningHistory;
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
  readonly context: PlanningClientContext;
  /** Request proof frozen with the action; context changes never replace an admitted write's proof. */
  readonly requestContext: PlanningClientContext;
  readonly generation: number;
}

export interface PlanningControllerOptions {
  getState: PlanningCacheStore['getState'];
  setState: PlanningCacheStore['setState'];
  transport: PlanningTransport;
  /** The current masquerade context proof, captured into each request when it is dispatched. */
  readMasqueradeContextToken: () => string | null;
  /** The capacity window each read asks for, captured when the read is sent. */
  readCapacityWindow?: () => CapacityRange | undefined;
  createMutationId?: () => string;
  /** Mints the page's in-memory history id; a new id starts a new, empty history. */
  createHistoryId?: () => string;
  onAuthLoss?: () => void;
  confirmRestorationCleanup?: (count: number, signal: AbortSignal) => Promise<boolean>;
}
