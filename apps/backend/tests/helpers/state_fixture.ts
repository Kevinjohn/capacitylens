import db from '@adonisjs/lucid/services/db';
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction';
import { seed } from '@capacitylens/shared/data/seed';
import type { AppData } from '@capacitylens/shared/types/entities';
import access from '#config/access_control';
import { encodeRow, readStateWithClient } from '#services/state_repository';
import { tables } from '#services/product_tables';

/** Reads one company fixture or combines explicit company reads of every stored company. */
export async function readState(
  companyId?: string,
  includeInactive = companyId === undefined
): Promise<AppData> {
  const client = db.connection();
  if (companyId !== undefined) return readStateWithClient(client, companyId, includeInactive);
  const accounts = await client.from('companies').select('id');
  const slices: AppData[] = [];
  for (const account of accounts) {
    slices.push(await readStateWithClient(client, String(account.id), includeInactive));
  }
  return {
    accounts: slices.flatMap((slice) => slice.accounts),
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
    for (const account of await trx.from('companies').select('id')) {
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

function filterCompanyRows<T extends { companyId: string }>(rows: T[], companyId: string): T[] {
  return rows.filter((row) => row.companyId === companyId);
}

export const replaceWithSeed = () => resetState(true);
