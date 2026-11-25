import EntityWriteException from '#exceptions/entity_write_exception';

/** Language, week start and time zone are fixed once the company exists. */
export default class FrozenCompanyFieldException extends EntityWriteException {
  static status = 409;
  static message =
    'Language, week start and time zone are set when the company is created and cannot be changed.';
}
