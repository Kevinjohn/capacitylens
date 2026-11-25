import ProductException from '#exceptions/product_exception';

export default class IdentityAuthorizationException extends ProductException {
  static status = 403;
  static code = 'IDENTITY_AUTHORIZATION_DENIED';
  static message = 'Forbidden.';
}
