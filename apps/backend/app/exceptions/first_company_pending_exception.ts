import { RefusalException } from '#exceptions/refusal_exception';

export class FirstCompanyPendingException extends RefusalException {
  static status = 409;
  static code = 'FIRST_COMPANY_PENDING';
  static message = 'Only the invited first Owner may join before the company exists.';
}
