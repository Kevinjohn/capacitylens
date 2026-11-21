import { RefusalException } from '#exceptions/refusal_exception';

export class FirstCompanyPendingException extends RefusalException {
  constructor() {
    super(
      'Only the invited first Owner may join before the company exists.',
      409,
      'FIRST_COMPANY_PENDING'
    );
  }
}
