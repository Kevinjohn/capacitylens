import type { HttpContext } from '@adonisjs/core/http';
import { AccountCommandError } from '#services/account_commands';
import { IdentityAuthorityError } from '#services/auth/authorization';
import { identityAuthorityResponse } from '#exceptions/http_error_mapping';
import { AdmissionError } from './errors.js';

/** Renders only safe admission failures; unexpected failures reach the central handler. */
export function renderAdmissionFailure(ctx: HttpContext, error: unknown) {
  if (error instanceof AdmissionError || error instanceof AccountCommandError) {
    return ctx.response.status(error.status).send(error.body());
  }
  if (error instanceof IdentityAuthorityError) {
    const response = identityAuthorityResponse(error, 'admission');
    return ctx.response.status(response.status).send(response.body);
  }
  throw error;
}
