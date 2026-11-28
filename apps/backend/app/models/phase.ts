import { PhaseSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { SoftDeletes } from '@kevinjohn/adonisjs-lucid-soft-delete'
import { timestampColumn } from '#services/models/scalar_column'
import type { DateTime } from 'luxon'
import { column } from '@adonisjs/lucid/orm'
import { withCompanyScope } from '#services/models/scoped_model'
/** A company-scoped project phase; deletion metadata stays internal to restoration. */
export default class Phase extends compose(PhaseSchema, SoftDeletes, withCompanyScope) {
  @column.dateTime(timestampColumn('phases', 'created_at')) declare createdAt: DateTime
  @column.dateTime({ serializeAs: null }) declare deletedAt: DateTime | null
  @column({ serializeAs: null }) declare deletedBatchId: string | null
  @column.dateTime(timestampColumn('phases', 'updated_at')) declare updatedAt: DateTime
}
