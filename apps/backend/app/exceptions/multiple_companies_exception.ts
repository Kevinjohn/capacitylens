import RefusalException from '#exceptions/refusal_exception';

/** The installation holds more than one company, which accounts do not support. */
export default class MultipleCompaniesException extends RefusalException {
  static status = 409;
  static code = 'MULTIPLE_COMPANIES';
  static message =
    'This installation has more than one company. Accounts need a single-company database.';
}
