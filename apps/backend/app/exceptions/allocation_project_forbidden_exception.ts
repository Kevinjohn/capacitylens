import EntityWriteException from '#exceptions/entity_write_exception'

/** Only an all-projects activity allocation names a project. */
export default class AllocationProjectForbiddenException extends EntityWriteException {
  static code = 'E_ALLOCATION_PROJECT_FORBIDDEN'
}
