import EntityWriteException from '#exceptions/entity_write_exception';

/** An external resource takes no time off. */
export default class TimeOffExternalResourceException extends EntityWriteException {
  static code = 'time_off_external_resource';
}
