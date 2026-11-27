import EntityWriteException from '#exceptions/entity_write_exception'

/** The time off's resource does not exist in this company. */
export default class TimeOffResourceInvalidException extends EntityWriteException {
  static code = 'E_TIME_OFF_RESOURCE_INVALID'
}
