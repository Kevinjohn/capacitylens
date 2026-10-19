import { AccountGettingStartedDismissalSchema } from '#database/schema'
import { beforeFetch, beforeFind } from '@adonisjs/lucid/orm'
import { forCompany, requireCompanyScope } from '#models/scoped_model'

export default class AccountGettingStartedDismissal extends AccountGettingStartedDismissalSchema {
  static forCompany = forCompany
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
}
