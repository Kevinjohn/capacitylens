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
import type { ModelColumnOptions } from '@adonisjs/lucid/types/model';
import { isJsonColumn } from '@kevinjohn/adonisjs-lucid-checked-columns';
import { transformRow } from '#transformers/row_transformer';
import type { ProductTable } from '#services/product_tables';

const buildSnakeKey = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const models = {
  companies: Company,
  clients: Client,
  disciplines: Discipline,
  projects: Project,
  phases: Phase,
  resources: Resource,
  activities: Activity,
  allocations: Allocation,
  time_off: TimeOff,
  closures: Closure,
} satisfies Record<
  ProductTable,
  { $columns: readonly string[]; $getColumn(name: string): ModelColumnOptions | undefined }
>;

/** Map a product row to its stored columns; `jsonColumn` model columns hold JSON text. */
export function encodeRow(table: ProductTable, row: Record<string, unknown>) {
  const model = models[table];
  return Object.fromEntries(
    model.$columns.map((key) => {
      const value = row[key];
      return [
        buildSnakeKey(key),
        isJsonColumn(model.$getColumn(key)) && value !== undefined && value !== null
          ? JSON.stringify(value)
          : (value ?? null),
      ];
    })
  );
}

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
    Client.query({ client })
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany(companyId)),
    Discipline.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Project.query({ client })
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany(companyId)),
    Phase.query({ client }).withScopes((scopes) => scopes.forCompany(companyId)),
    Resource.query({ client })
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany(companyId)),
    Activity.query({ client })
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany(companyId)),
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
