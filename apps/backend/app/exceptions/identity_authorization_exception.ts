export class IdentityAuthorizationException extends Error {
  code = 'IDENTITY_AUTHORITY_DENIED';
  status = 403;
}
