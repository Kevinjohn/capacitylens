import EntityWriteException from '#exceptions/entity_write_exception';

/** Example data goes only into a company that has never held planning records. */
export default class ExampleDataCompanyNotEmptyException extends EntityWriteException {
  static status = 409;
  static code = 'E_EXAMPLE_DATA_COMPANY_NOT_EMPTY';
  static message =
    'Example data can only be added to a company that has no people, clients, projects or allocations, including archived or deleted ones.';
}
