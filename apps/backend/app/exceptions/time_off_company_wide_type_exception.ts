import EntityWriteException from '#exceptions/entity_write_exception';

/** Company-wide time off names no resource. */
export default class TimeOffCompanyWideTypeException extends EntityWriteException {
  static code = 'E_TIME_OFF_COMPANY_WIDE_TYPE';
}
