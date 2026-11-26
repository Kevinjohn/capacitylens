import type { HttpErrorBody, ProductErrorCode } from '@capacitylens/shared/api/httpErrors';
import type { Infer } from '@vinejs/vine/types';
import type { ArchiveImpact } from '@capacitylens/shared/domain/lifecycle';
import type { CapacityAdvisory } from '@capacitylens/shared/lib/capacity';
import type { RepeatingAllocationAdvisory } from '@capacitylens/shared/lib/capacity/repeatAdvisory';
import type {
  Activity,
  Allocation,
  AppDataKey,
  Client,
  Closure,
  Company,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import type { planningHistoryStepValidator, planningMutationValidator } from '#validators/planning';

// Planning wire contracts: inferred input types, receipts, refusal codes and the failure body.

/** The validated mutation body; the controller takes the route's company from `params`. */
export type PlanningMutationInput = Omit<Infer<typeof planningMutationValidator>, 'params'>;
type SuppliedIntent = PlanningMutationInput['intent'];
type SuppliedAllocationRepeat = Extract<SuppliedIntent, { operation: 'allocation.createGroup' }>;
/**
 * An intent as executed and kept in history. A repeat a client sends names only its pattern; once
 * committed it also names the occurrence ids the server minted, so undo and redo address them.
 */
export type PlanningIntent =
  | Exclude<SuppliedIntent, SuppliedAllocationRepeat>
  | (SuppliedAllocationRepeat & { occurrenceIds?: string[] });
export type PlanningHistoryStepInput = Omit<Infer<typeof planningHistoryStepValidator>, 'params'>;

/** Whether the page that sent the request can step back or forward through its own changes. */
export interface PlanningHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

type PlanningRowByEntity = {
  companies: Company;
  disciplines: Discipline;
  resources: Resource;
  clients: Client;
  projects: Project;
  phases: Phase;
  activities: Activity;
  allocations: Allocation;
  timeOff: TimeOff;
  closures: Closure;
};

export type ProjectedPlanningRow = {
  [Entity in AppDataKey]: { entity: Entity; row: PlanningRowByEntity[Entity] };
}[AppDataKey];

export interface PlanningMutationSuccess {
  status: 'committed';
  mutationId: string;
  /** The company revision advances exactly once for a committed mutation. */
  revision: number;
  /** Destructive writes retain a server-side inverse; restore consumes its handle. */
  restoration:
    | { consumedGroupId: null; replacementGroupId: string }
    | { consumedGroupId: string; replacementGroupId: null }
    | { consumedGroupId: null; replacementGroupId: null };
  /** Rows this commit changed, as the writer may see them. Apply only on top of `revision - 1`. */
  changes: { upserts: ProjectedPlanningRow[]; removed: Array<{ entity: AppDataKey; id: string }> };
  /** The sending page's history after this commit; both false when it named no history. */
  history?: PlanningHistoryState;
  /** Active descendants this archive hid, measured from the committed before-state. */
  archived?: ArchiveImpact;
  /** Allocation create, update and duplicate: the saved row's capacity advisory. */
  advisory?: CapacityAdvisory;
  /** Allocation createGroup: advisory counts over the occurrences it wrote. */
  repeatAdvisory?: RepeatingAllocationAdvisory;
}

/** Product planning refusal codes; Kit codes retain their own contract. */
export const planningMutationErrorCodes = [
  'ACCOUNT_MEMBERSHIP_LOST',
  'AUTHORIZATION_DENIED',
  'STALE_REVISION',
  'MUTATION_ID_REUSED',
  'NO_CHANGE',
  'RESTORATION_CONFIRMATION_REQUIRED',
  'RESTORATION_CONFIRMATION_STALE',
] as const satisfies readonly ProductErrorCode[];
export type PlanningMutationErrorCode = (typeof planningMutationErrorCodes)[number];

/** Flat mutation failure body; conflicts use HTTP 409. */
export type PlanningMutationFailure = HttpErrorBody;
