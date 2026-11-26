import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { randomUUID } from 'node:crypto';
import app from '@adonisjs/core/services/app';
import { PlanningExecutionService } from '#services/planning/planning_execution_service';
import type { PlanningIntent } from '#validators/planning/contracts';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import { StateRepositoryService } from '#services/state_repository_service';

const stateRepository = new StateRepositoryService();
const planningExecution = await app.container.make(PlanningExecutionService);

/** The access an Owner holds in planning. */
export const owner: PlanningAccessGrant = {
  role: 'owner',
  canWrite: true,
  canSeePrivateNames: true,
  canSeeTimeOffNote: true,
};

/** Runs one planning intent in `trx` against the company's current state. */
export async function executePlanningIntent(
  trx: TransactionClientContract,
  companyId: string,
  intent: PlanningIntent,
  accessGrant: PlanningAccessGrant
) {
  const data = await stateRepository.readStateWithClient(trx, companyId, true);
  return planningExecution.executePlanningIntent({
    trx,
    companyId,
    intent,
    accessGrant,
    data,
    identity: { actorId: 'u-bruce', sessionId: 1, mutationId: randomUUID() },
  });
}
