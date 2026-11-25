import EntityWriteException from '#exceptions/entity_write_exception';

/** Only a person resource can carry an avatar URL. */
export default class ResourceAvatarUrlForbiddenException extends EntityWriteException {
  static code = 'resource_avatar_url_forbidden';
  static message = 'Only a person can have an avatar URL.';
}
