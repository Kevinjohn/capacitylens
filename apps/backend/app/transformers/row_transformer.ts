import { BaseTransformer } from '@adonisjs/core/transformers'
import type { BaseModel } from '@adonisjs/lucid/orm'
import type { ModelObject } from '@adonisjs/lucid/types/model'

/** Produces a stored row's camelCase wire shape from the model's column serialisation. */
export default class RowTransformer extends BaseTransformer<InstanceType<typeof BaseModel>> {
  toObject(): ModelObject {
    return this.resource.serialize()
  }
}

export function transformRow(row: InstanceType<typeof BaseModel>): ModelObject {
  return new RowTransformer(row).toObject()
}
