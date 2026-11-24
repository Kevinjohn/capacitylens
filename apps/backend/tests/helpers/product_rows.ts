import type { QueryClientContract } from '@adonisjs/lucid/types/database';
import type { LucidModel } from '@adonisjs/lucid/types/model';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import { productModels } from '#models_support/product_models';
import { rowAttributes } from '#models_support/row_attributes';

/**
 * Stores product rows of one table through its model, as the services write them. Without a
 * client the model's default connection is used.
 */
export async function insertProductRows(
  key: AppDataKey,
  rows: readonly object[],
  client?: QueryClientContract
) {
  const model: LucidModel = productModels[key];
  await model.createMany(
    rows.map((row) => rowAttributes(model, row)),
    client ? { client } : undefined
  );
}
