import type { HttpErrorBody, ProductErrorCode } from '@capacitylens/shared/api/httpErrors';
import type { Infer } from '@vinejs/vine/types';
import type { ArchiveImpact } from '@capacitylens/shared/domain/lifecycle';
import type { CapacityAdvisory } from '@capacitylens/shared/lib/capacity';
import type { RepeatingAllocationAdvisory } from '@capacitylens/shared/lib/capacity/repeatAdvisory';
import type {
  Account,
  Activity,
  Allocation,
  AppDataKey,
  Client,
  Closure,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import type {
  planningHistoryStepValidator,
  planningMutationValidator,
} from '#validators/planning_operations';

// Planning wire contracts: inferred input types, receipts, refusal codes and the failure body.

export type PlanningMutationInput = Infer<typeof planningMutationValidator>;
export type PlanningIntent = PlanningMutationInput['intent'];
export type PlanningHistoryStepInput = Infer<typeof planningHistoryStepValidator>;

/** Whether the page that sent the request can step back or forward through its own changes. */
export interface PlanningHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

type PlanningRowByEntity = {
  accounts: Account;
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
  /** The account revision advances exactly once for a committed mutation. */
  revision: number;
  /** Destructive writes retain a server-side inverse; restore consumes its handle. */
  restoration:
    | { consumedGroupId: null; replacementGroupId: string }
    | { consumedGroupId: string; replacementGroupId: null }
    | { consumedGroupId: null; replacementGroupId: null };
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
  'VALIDATION_ERROR',
  'ACCOUNT_MEMBERSHIP_LOST',
  'AUTHORIZATION_DENIED',
  'STALE_REVISION',
  'MUTATION_ID_REUSED',
  'NO_CHANGE',
  'RESTORATION_CONFIRMATION_REQUIRED',
  'RESTORATION_CONFIRMATION_STALE',
] as const satisfies readonly ProductErrorCode[];
export type PlanningMutationErrorCode = (typeof planningMutationErrorCodes)[number];

/** Flat command failure body; conflicts use HTTP 409. */
export type PlanningMutationFailure = HttpErrorBody;
