import { ProjectSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import { isBoolean, jsonColumn } from '#models/json_column'
import { isoTimestampColumn } from '#models/scalar_column'
import type { ISOTimestamp } from '@capacitylens/shared/types/entities'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'
export default class Project extends ProjectSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
  @column(jsonColumn('projects', 'is_private', isBoolean))
  declare isPrivate: boolean | null

  @column(isoTimestampColumn('projects', 'archived_at')) declare archivedAt: ISOTimestamp | null
  @column(isoTimestampColumn('projects', 'created_at')) declare createdAt: ISOTimestamp
  @column(isoTimestampColumn('projects', 'deleted_at')) declare deletedAt: ISOTimestamp | null
  @column(isoTimestampColumn('projects', 'updated_at')) declare updatedAt: ISOTimestamp
}
