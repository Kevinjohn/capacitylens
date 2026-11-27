import EntityWriteException from '#exceptions/entity_write_exception';

/** The record belongs to another company. */
export default class RecordWrongCompanyException extends EntityWriteException {
  static code = 'E_RECORD_WRONG_COMPANY';
}
