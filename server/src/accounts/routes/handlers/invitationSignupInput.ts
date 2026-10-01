import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { FastifyRequest } from "fastify";
import { buildPasswordLengthMessage, REPLY_ERRORS } from "../../../routes/replyErrors";
import type { ParseResult } from "../../../routes/routeShared";

type SignupInput = { email: string; name: string; password: string };

export function parseSignupInvitationInput(req: FastifyRequest): ParseResult<SignupInput, string> {
  const body = (req.body ?? {}) as { email?: unknown; name?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
  if (!isAccountEmail(email)) return { kind: "invalid", failure: REPLY_ERRORS.signupEmailInvalid };
  const name = typeof body.name === "string" ? cleanText(body.name) : "";
  if (name.length === 0) return { kind: "invalid", failure: REPLY_ERRORS.signupNameRequired };
  if (typeof body.password !== "string" || passwordLengthFailure(body.password)) {
    return { kind: "invalid", failure: buildPasswordLengthMessage(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) };
  }
  return { kind: "parsed", value: { email, name, password: body.password } };
}
