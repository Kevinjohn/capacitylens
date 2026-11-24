import type { AppData } from '@capacitylens/shared/types/entities';
import { buildActiveData } from '@capacitylens/shared/domain/lifecycle';
import Company from '#models/company';
import Activity from '#models/activity';
import Allocation from '#models/allocation';
import Client from '#models/client';
import Closure from '#models/closure';
import Discipline from '#models/discipline';
import Phase from '#models/phase';
import Project from '#models/project';
import Resource from '#models/resource';
import TimeOff from '#models/time_off';
import type { BaseModel } from '@adonisjs/lucid/orm';
import type { QueryClientContract } from '@adonisjs/lucid/types/database';
import { transformRow } from '#transformers/row_transformer';

function serializeRows(rows: InstanceType<typeof BaseModel>[]): Record<string, unknown>[] {
  return rows.map(transformRow);
}

/**
 * Reads one explicit company slice, refusing a blank company scope.
 * Inactive lifecycle rows are included only when requested.
 */
export async function readStateWithClient(
  client: QueryClientContract,
  companyId: string,
  includeInactive = false
): Promise<AppData> {
  if (companyId.trim() === '') {
    throw new Error('A company scope is required');
  }
  const [
    companies,
    clients,
    disciplines,
    projects,
    phases,
    resources,
    activities,
    allocations,
    timeOff,
    closures,
  ] = await Promise.all([
    Company.query({ client }).where('id', companyId),
    Client.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Discipline.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Project.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Phase.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Resource.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Activity.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Allocation.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    TimeOff.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Closure.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
  ]);
  const data = {
    companies: serializeRows(companies),
    clients: serializeRows(clients),
    disciplines: serializeRows(disciplines),
    projects: serializeRows(projects),
    phases: serializeRows(phases),
    resources: serializeRows(resources),
    activities: serializeRows(activities),
    allocations: serializeRows(allocations),
    timeOff: serializeRows(timeOff),
    closures: serializeRows(closures),
  } as unknown as AppData;
  return includeInactive ? data : buildActiveData(data);
}
