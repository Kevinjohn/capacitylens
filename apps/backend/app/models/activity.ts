import { ActivitySchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'
import { withCompanyScope } from '#services/models/scoped_model'
import { timestampColumn } from '#services/models/scalar_column'
/** A company-scoped activity; its kind governs project and phase references. */
export default class Activity extends compose(ActivitySchema, withCompanyScope) {
  @column.dateTime(timestampColumn('activities', 'archived_at'))
  declare archivedAt: DateTime | null
  @column.dateTime(timestampColumn('activities', 'created_at')) declare createdAt: DateTime
  @column.dateTime(timestampColumn('activities', 'updated_at')) declare updatedAt: DateTime
}
