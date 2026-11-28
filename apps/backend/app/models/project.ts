import { ProjectSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { column } from '@adonisjs/lucid/orm'
import { booleanColumn, timestampColumn } from '#services/models/scalar_column'
import type { DateTime } from 'luxon'
import { withCompanyScope } from '#services/models/scoped_model'
/** A company-scoped project; `isPrivate` protects its name in member projections. */
export default class Project extends compose(ProjectSchema, withCompanyScope) {
  @column(booleanColumn('projects', 'is_private'))
  declare isPrivate: boolean | null

  @column.dateTime(timestampColumn('projects', 'archived_at')) declare archivedAt: DateTime | null
  @column.dateTime(timestampColumn('projects', 'created_at')) declare createdAt: DateTime
  @column.dateTime(timestampColumn('projects', 'updated_at')) declare updatedAt: DateTime
}
