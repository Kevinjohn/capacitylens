import { InvitationSchema } from '#database/schema'
import { beforeFetch, beforeFind } from '@adonisjs/lucid/orm'
import { forCompany, forTrustedLocal, requireCompanyScope } from '#models/scoped_model'

export default class Invitation extends InvitationSchema {
  static forCompany = forCompany
  static forTrustedLocal = forTrustedLocal
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
}
