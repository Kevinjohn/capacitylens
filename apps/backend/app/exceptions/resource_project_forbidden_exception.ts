import EntityWriteException from '#exceptions/entity_write_exception'

/** Only a placeholder resource names a project. */
export default class ResourceProjectForbiddenException extends EntityWriteException {
  static code = 'E_RESOURCE_PROJECT_FORBIDDEN'
}
