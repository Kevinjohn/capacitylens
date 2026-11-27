import { ClientSchema } from '#database/schema'
import { compose } from '@adonisjs/core/helpers'
import { column } from '@adonisjs/lucid/orm'
import { booleanColumn, timestampColumn } from '#models_support/scalar_column'
import type { DateTime } from 'luxon'
import { withCompanyScope } from '#models_support/scoped_model'
/** A client row. `isPrivate` hides the name from non-owners; `builtin` marks the internal client. */
export default class Client extends compose(ClientSchema, withCompanyScope) {
  @column(booleanColumn('clients', 'is_private'))
  declare isPrivate: boolean | null

  @column(booleanColumn('clients', 'builtin'))
  declare builtin: boolean | null

  @column.dateTime(timestampColumn('clients', 'archived_at')) declare archivedAt: DateTime | null
  @column.dateTime(timestampColumn('clients', 'created_at')) declare createdAt: DateTime
  @column.dateTime(timestampColumn('clients', 'updated_at')) declare updatedAt: DateTime
}
