import EntityWriteException from '#exceptions/entity_write_exception'

/** An external resource takes no time off. */
export default class TimeOffExternalResourceException extends EntityWriteException {
  static code = 'E_TIME_OFF_EXTERNAL_RESOURCE'
}
