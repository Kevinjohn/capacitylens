import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyRequest } from "fastify";

/**
 * The "who is calling?" preamble every account route shares.
 *
 * Reading `req.accountActor` / `req.user` is transport plumbing, not authorisation: the port still
 * answers every authority question inside its transaction. It lives in one module because the
 * refusal must be identical wherever it happens — an unauthenticated caller learns only that they
 * need to sign in, never which route or account they touched.
 */
export function createAuthenticationRequiredError() {
  return new AccountContractError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Sign in to continue.",
    retryable: false,
  });
}

export function requireAccountActor(req: FastifyRequest) {
  if (!req.accountActor) throw createAuthenticationRequiredError();
  return req.accountActor;
}

export function requireAuthenticatedUser(req: FastifyRequest) {
  if (!req.user) throw createAuthenticationRequiredError();
  return req.user;
}

/** Both halves at once, for the handlers that need the actor AND the login behind it. */
export function requireAuthenticatedPrincipal(req: FastifyRequest) {
  return { actor: requireAccountActor(req), user: requireAuthenticatedUser(req) };
}
