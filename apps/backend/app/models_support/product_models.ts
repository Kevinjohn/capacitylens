import type { QueryClientContract } from '@adonisjs/lucid/types/database';
import type { LucidModel, LucidRow, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model';
import type { AppDataKey, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import Activity from '#models/activity';
import Allocation from '#models/allocation';
import Client from '#models/client';
import Closure from '#models/closure';
import Company from '#models/company';
import Discipline from '#models/discipline';
import Phase from '#models/phase';
import Project from '#models/project';
import Resource from '#models/resource';
import TimeOff from '#models/time_off';

/** The Lucid model of each product table, keyed like `AppData`. */
export const productModels = {
  companies: Company,
  clients: Client,
  disciplines: Discipline,
  projects: Project,
  phases: Phase,
  resources: Resource,
  activities: Activity,
  allocations: Allocation,
  timeOff: TimeOff,
  closures: Closure,
} as const satisfies Record<AppDataKey, LucidModel>;

/**
 * A model query on one company-scoped product table, restricted to one company, for callers that
 * handle every product table alike. Soft-deleted rows stay hidden, as on every model read.
 */
export function companyRows(
  key: ScopedEntityKey,
  companyId: string,
  client: QueryClientContract
): ModelQueryBuilderContract<LucidModel, LucidRow> {
  // Every scoped model declares the same `forCompany` scope, so Client's type stands for each.
  const model = productModels[key] as unknown as typeof Client;
  return model
    .query({ client })
    .withScopes((scopes) => scopes.forCompany(companyId)) as unknown as ModelQueryBuilderContract<
    LucidModel,
    LucidRow
  >;
}
