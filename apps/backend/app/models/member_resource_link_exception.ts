import { MemberResourceLinkExceptionSchema } from '#database/schema'
import { beforeFetch, beforeFind } from '@adonisjs/lucid/orm'
import { forCompany, requireCompanyScope } from '#models/scoped_model'

export default class MemberResourceLinkException extends MemberResourceLinkExceptionSchema {
  static forCompany = forCompany
  @beforeFind() static requireFindScope = requireCompanyScope
  @beforeFetch() static requireFetchScope = requireCompanyScope
}
