import EntityWriteException from '#exceptions/entity_write_exception';

/** A date is not a valid calendar date. */
export default class DateInvalidException extends EntityWriteException {
  static code = 'E_DATE_INVALID';
}
