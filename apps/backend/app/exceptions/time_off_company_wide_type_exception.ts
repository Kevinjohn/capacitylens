import EntityWriteException from '#exceptions/entity_write_exception';

/** Company-wide time off names no resource. */
export default class TimeOffCompanyWideTypeException extends EntityWriteException {
  static code = 'time_off_company_wide_type';
}
