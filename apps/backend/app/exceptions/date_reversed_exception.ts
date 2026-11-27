import EntityWriteException from '#exceptions/entity_write_exception'

/** The end date is before the start date. */
export default class DateReversedException extends EntityWriteException {
  static code = 'date_reversed'
}
