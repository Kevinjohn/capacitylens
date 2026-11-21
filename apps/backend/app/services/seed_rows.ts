import { seed } from '@capacitylens/shared/data/seed';
import { withTransaction } from '#services/with_transaction';
import { tables } from '#services/product_tables';
import { encodeRow } from '#services/state_repository';

/** Add the seed rows without replacing operator data or audit history. */
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
