import EntityWriteException from '#exceptions/entity_write_exception';

/** A referenced record belongs to another company. */
export default class ReferenceWrongCompanyException extends EntityWriteException {
  static code = 'reference_wrong_company';
}
