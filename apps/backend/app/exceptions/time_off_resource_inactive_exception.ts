import EntityWriteException from '#exceptions/entity_write_exception'

/** The time off's resource is not active in this company. */
export default class TimeOffResourceInactiveException extends EntityWriteException {
  static code = 'E_TIME_OFF_RESOURCE_INACTIVE'
}
