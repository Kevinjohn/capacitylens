import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { activeOnly } from '@capacitylens/shared/domain/lifecycle';
import { buildGettingStartedSteps } from '@capacitylens/shared/domain/gettingStarted';
import { readStateWithClient } from '#services/state_repository';

/** The company's getting-started milestones, from the same active projection the planning read uses. */
export async function readGettingStartedSteps(trx: TransactionClientContract, companyId: string) {
  return buildGettingStartedSteps(activeOnly(await readStateWithClient(trx, companyId, true)));
}

/** Whether the company has dismissed its getting-started panel. */
export async function isGettingStartedDismissed(trx: TransactionClientContract, companyId: string) {
  const row = await trx
    .from('account_getting_started_dismissals')
    .where('company_id', companyId)
    .first();
  return Boolean(row);
}

/** Records the company's dismissal once; a repeat is ignored. */
export async function dismissGettingStarted(
  trx: TransactionClientContract,
  companyId: string,
  now: string
) {
  await trx
    .table('account_getting_started_dismissals')
    .insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      created_at: now,
      updated_at: now,
    })
    .onConflict('company_id')
    .ignore();
}
