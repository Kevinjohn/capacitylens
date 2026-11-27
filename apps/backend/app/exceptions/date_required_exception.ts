import EntityWriteException from '#exceptions/entity_write_exception'

/** A start or end date is missing. */
export default class DateRequiredException extends EntityWriteException {
  static code = 'E_DATE_REQUIRED'
}
