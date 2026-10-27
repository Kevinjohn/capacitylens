import { ClientSchema } from '#database/schema'
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { SoftDeletes } from '@kevinjohn/lucid-soft-deletes'
import { isBoolean, jsonColumn } from '#models/json_column'
import { deletedAtColumn, isoTimestampColumn } from '#models/scalar_column'
import type { ISOTimestamp } from '@capacitylens/shared/types/entities'
import type { DateTime } from 'luxon'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
import Project from '#models/project'
export default class Client extends SoftDeletes(ClientSchema) {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @hasMany(() => Project, { foreignKey: 'clientId' }) declare projects: HasMany<typeof Project>
  @column(jsonColumn('clients', 'is_private', isBoolean))
  declare isPrivate: boolean | null

  @column(jsonColumn('clients', 'builtin', isBoolean))
  declare builtin: boolean | null

  @column(isoTimestampColumn('clients', 'archived_at')) declare archivedAt: ISOTimestamp | null
  @column(isoTimestampColumn('clients', 'created_at')) declare createdAt: ISOTimestamp
  @column.dateTime(deletedAtColumn)
  declare deletedAt: DateTime | null
  @column(isoTimestampColumn('clients', 'updated_at')) declare updatedAt: ISOTimestamp
}
