import EntityWriteException from '#exceptions/entity_write_exception';

/** The avatar URL failed validation; the sentence names why. */
export default class ResourceAvatarUrlInvalidException extends EntityWriteException {
  static code = 'resource_avatar_url_invalid';
}
