import EntityWriteException from '#exceptions/entity_write_exception'

/** The time off's resource is not active in this company. */
export default class TimeOffResourceInactiveException extends EntityWriteException {
  static code = 'time_off_resource_inactive'
}
