import db from '@adonisjs/lucid/services/db';
import type { AppData } from '@capacitylens/shared/types/entities';
import { seed, seedForCurrentWeek } from '@capacitylens/shared/data/seed';
import { activeOnly } from '@capacitylens/shared/domain/lifecycle';
import { assertSchemaIntegrity } from '#services/schema_integrity';
import { withTransaction } from '#services/with_transaction';
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction';
import access from '#config/access_control';
import Account from '#models/account';
import { establishInitialCompanyAuthority } from '#services/initial_company_authority';
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
import { isJsonColumn } from '#models/json_column';

const tables = {
  accounts: 'accounts',
  clients: 'clients',
  disciplines: 'disciplines',
  projects: 'projects',
  phases: 'phases',
  resources: 'resources',
  activities: 'activities',
  allocations: 'allocations',
  timeOff: 'time_off',
  closures: 'closures',
} as const;
export type ProductTable = (typeof tables)[keyof typeof tables];

const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const models = {
  accounts: Account,
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
        snake(key),
        isJsonColumn(model.$getColumn(key)) && value !== undefined && value !== null
          ? JSON.stringify(value)
          : (value ?? null),
      ];
    })
  );
}

function serializeRows(rows: InstanceType<typeof BaseModel>[]): Record<string, unknown>[] {
  return rows.map((model) => model.serialize());
}

/** Reads the trusted-local whole database, or one fail-closed tenant slice. */
export async function readStateWithClient(
  client: QueryClientContract,
  accountId?: string,
  includeInactive = accountId === undefined
): Promise<AppData> {
  if (accountId !== undefined && accountId.trim() === '') {
    throw new Error('A company scope is required');
  }
  const [
    accounts,
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
    accountId === undefined
      ? Account.query({ client })
      : Account.query({ client }).where('id', accountId),
    accountId === undefined
      ? Client.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forWholeInstallation())
      : Client.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Discipline.query({ client }).withScopes((scopes) => scopes.forWholeInstallation())
      : Discipline.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Project.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forWholeInstallation())
      : Project.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Phase.query({ client }).withScopes((scopes) => scopes.forWholeInstallation())
      : Phase.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Resource.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forWholeInstallation())
      : Resource.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Activity.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forWholeInstallation())
      : Activity.query({ client })
          .withTrashed()
          .withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Allocation.query({ client }).withScopes((scopes) => scopes.forWholeInstallation())
      : Allocation.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? TimeOff.query({ client }).withScopes((scopes) => scopes.forWholeInstallation())
      : TimeOff.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Closure.query({ client }).withScopes((scopes) => scopes.forWholeInstallation())
      : Closure.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
  ]);
  const data = {
    accounts: serializeRows(accounts),
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
  return includeInactive ? data : activeOnly(data);
}

/** Reads through an ordinary connection; transactional callers pass their transaction instead. */
export function readState(accountId?: string, includeInactive = accountId === undefined) {
  return readStateWithClient(db.connection(), accountId, includeInactive);
}

export async function resetState(seedRequested: boolean | 'single') {
  // The Kit runner holds the writer lock the package's membership removal relies on.
  await transaction(db, async (trx) => {
    await trx.from('audit_entries').delete();
    // Memberships restrict company deletion, so the package removes them first.
    for (const account of await trx.from('accounts').select('id')) {
      await access.memberships.removeAllForScope({ scopeId: String(account.id), trx });
    }
    for (const table of Object.values(tables).reverse()) await trx.from(table).delete();
    if (!seedRequested) return;
    const seeded = seed();
    const firstAccountId = seeded.accounts[0]?.id;
    const data =
      seedRequested === 'single' && firstAccountId
        ? {
            ...seeded,
            accounts: seeded.accounts.filter((row) => row.id === firstAccountId),
            clients: filterCompanyRows(seeded.clients, firstAccountId),
            disciplines: filterCompanyRows(seeded.disciplines, firstAccountId),
            projects: filterCompanyRows(seeded.projects, firstAccountId),
            phases: filterCompanyRows(seeded.phases, firstAccountId),
            resources: filterCompanyRows(seeded.resources, firstAccountId),
            activities: filterCompanyRows(seeded.activities, firstAccountId),
            allocations: filterCompanyRows(seeded.allocations, firstAccountId),
            timeOff: filterCompanyRows(seeded.timeOff, firstAccountId),
            closures: filterCompanyRows(seeded.closures, firstAccountId),
          }
        : seeded;
    for (const [key, table] of Object.entries(tables)) {
      const rows = data[key as keyof typeof tables];
      if (rows.length > 0) {
        await trx
          .table(table)
          .multiInsert(
            rows.map((row) => encodeRow(table, row as unknown as Record<string, unknown>))
          );
      }
    }
  });
}

/** Add fixture rows without replacing operator data or audit history. */
export async function insertSeed() {
  await withTransaction(async (trx) => {
    const data = seed();
    for (const [key, table] of Object.entries(tables)) {
      const rows = data[key as keyof typeof tables];
      if (rows.length > 0) {
        await trx
          .table(table)
          .insert(rows.map((row) => encodeRow(table, row as unknown as Record<string, unknown>)))
          .onConflict('id')
          .ignore();
      }
    }
  });
}

function filterCompanyRows<T extends { accountId: string }>(rows: T[], accountId: string): T[] {
  return rows.filter((row) => row.accountId === accountId);
}

export const replaceWithSeed = () => resetState(true);

export async function checkDatabase() {
  await db.rawQuery('select 1');
  await assertSchemaIntegrity();
}

/** Insert the single disposable company graph and its authority in one transaction. */
export async function insertDisposableDemoSeed(ownerId: string) {
  await withTransaction(async (trx) => {
    if (await trx.from('accounts').first()) {
      throw new Error('Refusing demo seed: companies already exist');
    }
    if (await trx.from('memberships').first()) {
      throw new Error('Refusing demo seed: memberships already exist');
    }
    const data = seedForCurrentWeek();
    const company = data.accounts.find((account) => account.id === 'a-studio');
    if (!company) throw new Error('Disposable company fixture is missing');
    for (const [key, table] of Object.entries(tables)) {
      const rows =
        key === 'accounts'
          ? [company]
          : data[key as keyof typeof tables].filter(
              (row) => 'accountId' in row && row.accountId === company.id
            );
      if (rows.length > 0) {
        await trx
          .table(table)
          .multiInsert(
            rows.map((row) => encodeRow(table, row as unknown as Record<string, unknown>))
          );
      }
    }
    await establishInitialCompanyAuthority(trx, {
      accountId: company.id,
      ownerId,
      actorId: ownerId,
      now: new Date().toISOString(),
    });
  });
}
