import EntityWriteException from '#exceptions/entity_write_exception'

/** The placeholder has allocations that its new project cannot keep. */
export default class PlaceholderProjectDependentsException extends EntityWriteException {
  static code = 'placeholder_project_dependents'
}
