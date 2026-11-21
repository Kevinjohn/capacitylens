import { Exception } from '@adonisjs/core/exceptions';

export class IdentityAuthorizationException extends Exception {
  static status = 403;
  static code = 'IDENTITY_AUTHORITY_DENIED';
}
