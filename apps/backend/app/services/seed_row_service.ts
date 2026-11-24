import { seed } from '@capacitylens/shared/data/seed';
import db from '@adonisjs/lucid/services/db';
import type { LucidModel } from '@adonisjs/lucid/types/model';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';
import { tables } from '#models_support/product_tables';

/** The development and test seed rows. */
export class SeedRowService {
  /** Add the seed rows without replacing operator data or audit history. */
  async insertSeed() {
    await db.transaction(async (trx) => {
      const data = seed();
      for (const key of Object.keys(tables) as AppDataKey[]) {
        const rows: readonly { id: string }[] = data[key];
        if (rows.length === 0) continue;
        // A row whose id is stored already, in any company and even soft-deleted, is kept as it is.
        const stored = await trx
          .from(tables[key])
          .whereIn(
            'id',
            rows.map((row) => row.id)
          )
          .select('id');
        const existing = new Set(stored.map((row) => String(row.id)));
        const model: LucidModel = productModels[key];
        await model.createMany(
          rows.filter((row) => !existing.has(row.id)).map((row) => rowAttributes(model, row)),
          { client: trx }
        );
      }
    });
  }
}
