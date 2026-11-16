import type { AppData } from '@capacitylens/shared/types/entities';
import type {
  PlanningExecution,
  PlanningHistoryEntry,
  PlanningIntent,
  PlanningMutationLookup,
  PlanningMutationSuccess,
} from '@/api/planningContracts';

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

/**
 * The server port. Error contract: the controller reads any thrown value for `code`, `status` and
 * `message` only. On `execute`, status 401 ends the planning scope; code `MUTATION_ID_REUSED`, status
 * 408, a status of 500 or more, or no status (a network failure) leaves the commit boundary unknown,
 * so the controller marks the write uncertain and reconciles through `lookup`; code `STALE_REVISION`
 * or status 409 is refused and refreshed; codes `AUTHORIZATION_DENIED`, `VALIDATION_ERROR` and
 * `NO_CHANGE`, and any other status below 500, are refused. Only a server request to confirm cleanup
 * must be a `PlanningControllerError`: code `RESTORATION_CONFIRMATION_REQUIRED` with a positive
 * `restorableItemCount`. A transport must not set `uncertain`; the controller sets it on failures it
 * has already recorded. A `read` or `lookup` failure ends the scope on 401 and is otherwise recorded
 * on the planning state.
 */
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
  createMutationId?: () => string;
  onAuthLoss?: () => void;
  confirmRestorationCleanup?: (count: number, signal: AbortSignal) => Promise<boolean>;
}
