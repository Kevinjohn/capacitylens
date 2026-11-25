import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { buildExampleCompany, countExampleRows } from '@capacitylens/shared/data/exampleCompany';
import logger from '@adonisjs/core/services/logger';
import { resolveCalendarToday } from '@capacitylens/shared/lib/calendarToday';
import type { LucidModel } from '@adonisjs/lucid/types/model';
import { productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';
import { StateRepositoryService } from '#services/state_repository_service';
import { AuditService } from '#services/audit_service';
import { PlanningRevisionService } from '#services/planning_revision_service';
import EntityNotFoundException from '#exceptions/entity_not_found_exception';
import ExampleDataCompanyNotEmptyException from '#exceptions/example_data_company_not_empty_exception';

const INSERT_ORDER = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'timeOff',
] as const;

/** The example company's rows, added to an empty company. */
@inject()
export class ExampleDataService {
  #stateRepository: StateRepositoryService;
  #audit: AuditService;
  #planningRevisions: PlanningRevisionService;

  constructor(
    stateRepository: StateRepositoryService,
    audit: AuditService,
    planningRevisions: PlanningRevisionService
  ) {
    this.#stateRepository = stateRepository;
    this.#audit = audit;
    this.#planningRevisions = planningRevisions;
  }

  /**
   * Adds the example company's rows to a company that has no people, clients, projects or
   * allocations, records the audit entry and advances the planning revision. Returns the row count.
   */
  async addExampleData(trx: TransactionClientContract, companyId: string, actorId: string) {
    const state = await this.#stateRepository.readStateWithClient(trx, companyId, true);
    const company = state.companies.at(0);
    if (!company) throw new EntityNotFoundException('Company not found.');
    if (
      state.resources.length > 0 ||
      state.clients.some((client) => client.builtin !== true) ||
      state.projects.length > 0 ||
      state.allocations.length > 0
    ) {
      throw new ExampleDataCompanyNotEmptyException();
    }
    const today = resolveCalendarToday(company.timezone ?? undefined);
    if (today.kind === 'invalid-time-zone') {
      // The example still lands around the server's local date; the operator log names the zone.
      logger.warn(
        { timeZone: today.timeZone, err: today.cause },
        'Example data used the local date because the company time zone is invalid'
      );
    }
    const sample = buildExampleCompany({
      companyId,
      referenceDate: today.date,
      weekStartsOn: company.weekStartsOn ?? 1,
    });
    for (const key of INSERT_ORDER) {
      const model: LucidModel = productModels[key];
      await model.createMany(
        sample[key].map((row) => rowAttributes(model, row)),
        { client: trx }
      );
    }
    await this.#audit.writeAudit(trx, {
      companyId,
      actorId,
      action: 'exampleData',
      entity: 'company',
      entityId: companyId,
      fields: Object.keys(sample),
    });
    await this.#planningRevisions.advancePlanningRevision(trx, companyId);
    return countExampleRows(sample);
  }
}
