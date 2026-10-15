import { AuditEntrySchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import { isJsonValue, jsonColumn } from '#models/json_column'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'

export default class AuditEntry extends AuditEntrySchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope

  @column(jsonColumn('audit_entries', 'details', isJsonValue))
  declare details: unknown | null
}
