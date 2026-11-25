import EntityWriteException from '#exceptions/entity_write_exception';

/** The date span is longer than the product allows. */
export default class DateSpanTooLongException extends EntityWriteException {
  static code = 'date_span_too_long';
}
