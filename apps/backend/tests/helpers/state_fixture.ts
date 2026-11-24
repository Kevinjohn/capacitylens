import db from '@adonisjs/lucid/services/db';
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction';
import { seed } from '@capacitylens/shared/data/seed';
import type { AppData } from '@capacitylens/shared/types/entities';
import access from '#config/access_control';
import { readStateWithClient } from '#services/state_repository';
import { insertProductRows } from '#tests/helpers/product_rows';
import { tables } from '#models_support/product_tables';

/** Reads one company fixture or combines explicit company reads of every stored company. */
export async function readState(
  companyId?: string,
  includeInactive = companyId === undefined
): Promise<AppData> {
  const client = db.connection();
  if (companyId !== undefined) return readStateWithClient(client, companyId, includeInactive);
  const companies = await client.from('companies').select('id');
  const slices: AppData[] = [];
  for (const company of companies) {
    slices.push(await readStateWithClient(client, String(company.id), includeInactive));
  }
  return {
    companies: slices.flatMap((slice) => slice.companies),
    clients: slices.flatMap((slice) => slice.clients),
    disciplines: slices.flatMap((slice) => slice.disciplines),
    projects: slices.flatMap((slice) => slice.projects),
    phases: slices.flatMap((slice) => slice.phases),
    resources: slices.flatMap((slice) => slice.resources),
    activities: slices.flatMap((slice) => slice.activities),
    allocations: slices.flatMap((slice) => slice.allocations),
    timeOff: slices.flatMap((slice) => slice.timeOff),
    closures: slices.flatMap((slice) => slice.closures),
  };
}

/** Empties every product table, then optionally inserts the fixture seed or its first company. */
export async function resetState(seedRequested: boolean | 'single') {
  // The Kit runner holds the writer lock the package's membership removal relies on.
  await transaction(db, async (trx) => {
    await trx.from('audit_entries').delete();
    // Memberships restrict company deletion, so the package removes them first.
    for (const company of await trx.from('companies').select('id')) {
      await access.memberships.removeAllForScope({ scopeId: String(company.id), trx });
    }
    for (const table of Object.values(tables).reverse()) await trx.from(table).delete();
    if (!seedRequested) return;
    const seeded = seed();
    const firstCompanyId = seeded.companies[0]?.id;
    const data =
      seedRequested === 'single' && firstCompanyId
        ? {
            ...seeded,
            companies: seeded.companies.filter((row) => row.id === firstCompanyId),
            clients: filterCompanyRows(seeded.clients, firstCompanyId),
            disciplines: filterCompanyRows(seeded.disciplines, firstCompanyId),
            projects: filterCompanyRows(seeded.projects, firstCompanyId),
            phases: filterCompanyRows(seeded.phases, firstCompanyId),
            resources: filterCompanyRows(seeded.resources, firstCompanyId),
            activities: filterCompanyRows(seeded.activities, firstCompanyId),
            allocations: filterCompanyRows(seeded.allocations, firstCompanyId),
            timeOff: filterCompanyRows(seeded.timeOff, firstCompanyId),
            closures: filterCompanyRows(seeded.closures, firstCompanyId),
          }
        : seeded;
    for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
      await insertProductRows(key, data[key], trx);
    }
  });
}

function filterCompanyRows<T extends { companyId: string }>(rows: T[], companyId: string): T[] {
  return rows.filter((row) => row.companyId === companyId);
}

export const replaceWithSeed = () => resetState(true);
