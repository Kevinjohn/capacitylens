import db from '@adonisjs/lucid/services/db';
import { transaction } from '@kevinjohn/adonisjs-account-kit/transaction';
import { seed } from '@capacitylens/shared/data/seed';
import access from '#config/access_control';
import { encodeRow, readStateWithClient, tables } from '#services/state_repository';

/** Reads through an ordinary connection; transactional callers pass their transaction instead. */
export function readState(accountId?: string, includeInactive = accountId === undefined) {
  return readStateWithClient(db.connection(), accountId, includeInactive);
}

/** Empties every product table, then optionally inserts the fixture seed or its first company. */
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

function filterCompanyRows<T extends { accountId: string }>(rows: T[], accountId: string): T[] {
  return rows.filter((row) => row.accountId === accountId);
}

export const replaceWithSeed = () => resetState(true);
