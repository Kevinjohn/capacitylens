import type { HttpErrorBody, ProductErrorCode } from '@capacitylens/shared/api/httpErrors';
import type { Infer } from '@vinejs/vine/types';
import type { ArchiveImpact } from '@capacitylens/shared/domain/lifecycle';
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
import type { planningMutationValidator } from '#validators/planning_operations';

// Planning wire contracts: inferred input types, receipts, refusal codes and the failure body.

export type PlanningMutationInput = Infer<typeof planningMutationValidator>;
export type PlanningIntent = PlanningMutationInput['intent'];

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
  projection:
    | {
        mode: 'patch';
        history: 'retain';
        changed: {
          upserts: ProjectedPlanningRow[];
          removed: Array<{ entity: AppDataKey; id: string }>;
        };
      }
    | { mode: 'refetch'; history: 'clear' };
  /** Active descendants this archive hid, measured from the committed before-state. */
  archived?: ArchiveImpact;
}

/** A commitment lookup never returns a prior response or a before-image. */
export type PlanningMutationLookup =
  | { status: 'committed'; mutationId: string; revision: number; restorationGroupId?: string }
  | { status: 'unknown'; mutationId: string };

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
