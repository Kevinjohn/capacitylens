import EntityWriteException from '#exceptions/entity_write_exception'

/** Only a person resource can carry an avatar URL. */
export default class ResourceAvatarUrlForbiddenException extends EntityWriteException {
  static code = 'E_RESOURCE_AVATAR_URL_FORBIDDEN'
  static message = 'Only a person can have an avatar URL.'
}
