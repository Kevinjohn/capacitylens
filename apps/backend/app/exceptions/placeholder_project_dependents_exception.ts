import EntityWriteException from '#exceptions/entity_write_exception'

/** The placeholder has allocations that its new project cannot keep. */
export default class PlaceholderProjectDependentsException extends EntityWriteException {
  static code = 'E_PLACEHOLDER_PROJECT_DEPENDENTS'
}
