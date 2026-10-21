import { AccountJoiningPolicySchema } from '#database/schema'
import { beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import { isArrayOf, jsonColumn } from '#models/json_column'
import { forCompany, requireCompanyScope } from '#models/scoped_model'

const isString = (value: unknown): value is string => typeof value === 'string'

export default class AccountJoiningPolicy extends AccountJoiningPolicySchema {
  static forCompany = forCompany
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope

  @column(jsonColumn('account_joining_policies', 'approved_domains', isArrayOf(isString)))
  declare approvedDomains: string[]
}
