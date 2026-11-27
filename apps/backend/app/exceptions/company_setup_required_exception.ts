import RefusalException from '#exceptions/refusal_exception'

/** No company exists yet, so nobody can be admitted to it. */
export default class CompanySetupRequiredException extends RefusalException {
  static status = 409
  static code = 'E_COMPANY_SETUP_REQUIRED'
  static message = 'The company has not been set up yet.'
}
