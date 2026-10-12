import { CompanySettingSchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import { isJsonValue, jsonColumn } from '#models/json_column'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'

export default class CompanySetting extends CompanySettingSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope

  @column(jsonColumn('company_settings', 'value', isJsonValue))
  declare value: unknown | null
}
