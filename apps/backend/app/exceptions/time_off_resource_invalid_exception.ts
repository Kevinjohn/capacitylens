import EntityWriteException from '#exceptions/entity_write_exception';

/** The time off's resource does not exist in this company. */
export default class TimeOffResourceInvalidException extends EntityWriteException {
  static code = 'time_off_resource_invalid';
}
