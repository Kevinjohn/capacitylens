import EntityWriteException from '#exceptions/entity_write_exception'

/** The date span is longer than the product allows. */
export default class DateSpanTooLongException extends EntityWriteException {
  static code = 'E_DATE_SPAN_TOO_LONG'
}
