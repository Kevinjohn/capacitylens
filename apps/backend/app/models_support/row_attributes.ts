import type { LucidModel, ModelAttributes } from '@adonisjs/lucid/types/model'
import { isIsoInstant } from '@capacitylens/shared/account/types'
import { DateTime } from 'luxon'

/**
 * The model attributes for a product row: every model column, a missing value as null, and each
 * date-time column's canonical UTC ISO string as the Luxon value its column `prepare` stores
 * unchanged. This is the one way a product row becomes model attributes for a write.
 */
export function rowAttributes<Model extends LucidModel>(
  model: Model,
  row: object
): Partial<ModelAttributes<InstanceType<Model>>> {
  const values = row as Record<string, unknown>
  const attributes: Record<string, unknown> = {}
  for (const [property, column] of model.$columnsDefinitions) {
    const value = values[property] ?? null
    if (column.meta?.type !== 'datetime' || value === null) {
      attributes[property] = value
    } else if (isIsoInstant(value)) {
      attributes[property] = DateTime.fromMillis(Date.parse(value), { zone: 'utc' })
    } else {
      throw new Error(`Invalid timestamp in ${model.table}.${column.columnName}`)
    }
  }
  // The loop covers exactly the model's columns, so the record is the model's attribute shape.
  return attributes as Partial<ModelAttributes<InstanceType<Model>>>
}
