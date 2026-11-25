import { RefusalException } from '#exceptions/refusal_exception';

/** The installation holds more than one company, which accounts do not support. */
export class MultipleCompaniesException extends RefusalException {
  static status = 409;
  static code = 'MULTIPLE_COMPANIES';
  static message =
    'This installation has more than one company. Accounts need a single-company database.';
}

/** No company exists yet, so nobody can be admitted to it. */
export class CompanySetupRequiredException extends RefusalException {
  static status = 409;
  static code = 'COMPANY_SETUP_REQUIRED';
  static message = 'The company has not been set up yet.';
}

/** The caller's membership is suspended. */
export class MembershipSuspendedException extends RefusalException {
  static status = 409;
  static code = 'MEMBERSHIP_SUSPENDED';
  static message =
    'Your membership in this company is suspended. Ask an Owner or Admin to restore it.';
}
