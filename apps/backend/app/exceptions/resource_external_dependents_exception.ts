import EntityWriteException from '#exceptions/entity_write_exception'

/** A resource with work or time off cannot become external. */
export default class ResourceExternalDependentsException extends EntityWriteException {
  static code = 'E_RESOURCE_EXTERNAL_DEPENDENTS'
}
