import type { HttpContext } from '@adonisjs/core/http';
import { AccountCommandError } from '#services/account_commands';
import { IdentityAuthorityError } from '#services/auth/authorization';
import { AdmissionError } from './errors.js';

/** Renders only safe admission failures; unexpected failures reach the central handler. */
export function renderAdmissionFailure(ctx: HttpContext, error: unknown) {
  if (error instanceof AdmissionError || error instanceof AccountCommandError) {
    return ctx.response.status(error.status).send(error.body());
  }
  if (error instanceof IdentityAuthorityError) {
    return ctx.response.forbidden({ error: 'Forbidden.', code: error.code });
  }
  throw error;
}
