import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { buildActiveData } from '@capacitylens/shared/domain/lifecycle';
import { buildGettingStartedSteps } from '@capacitylens/shared/domain/gettingStarted';
import { StateRepositoryService } from '#services/state_repository_service';

/** The company's getting-started milestones and their dismissal. */
@inject()
export class GettingStartedService {
  #stateRepository: StateRepositoryService;

  constructor(stateRepository: StateRepositoryService) {
    this.#stateRepository = stateRepository;
  }

  /** The company's getting-started milestones, from the same active projection the planning read uses. */
  async readGettingStartedSteps(trx: TransactionClientContract, companyId: string) {
    return buildGettingStartedSteps(
      buildActiveData(await this.#stateRepository.readStateWithClient(trx, companyId, true))
    );
  }

  /** Whether the company has dismissed its getting-started panel. */
  async isGettingStartedDismissed(trx: TransactionClientContract, companyId: string) {
    const row = await trx
      .from('company_getting_started_dismissals')
      .where('company_id', companyId)
      .first();
    return Boolean(row);
  }

  /** Records the company's dismissal once; a repeat is ignored. */
  async dismissGettingStarted(trx: TransactionClientContract, companyId: string, now: string) {
    await trx
      .table('company_getting_started_dismissals')
      .insert({
        id: crypto.randomUUID(),
        company_id: companyId,
        created_at: now,
        updated_at: now,
      })
      .onConflict('company_id')
      .ignore();
  }
}
