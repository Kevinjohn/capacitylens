import RefusalException from '#exceptions/refusal_exception'

export default class FirstCompanyPendingException extends RefusalException {
  static status = 409
  static code = 'E_FIRST_COMPANY_PENDING'
  static message = 'Only the invited first Owner may join before the company exists.'
}
