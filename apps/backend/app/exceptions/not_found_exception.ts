import RefusalException from '#exceptions/refusal_exception';

/** The named record is missing, or the caller may not know it exists. */
export default class NotFoundException extends RefusalException {
  static status = 404;
  static code = 'E_NOT_FOUND';
}
