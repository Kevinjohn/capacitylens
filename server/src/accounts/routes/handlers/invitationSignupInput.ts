import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { FastifyRequest } from "fastify";

type SignupInput = { email: string; name: string; password: string };

export function parseSignupInvitationInput(
  req: FastifyRequest,
): { value: SignupInput; failure?: never } | { failure: string; value?: never } {
  const body = (req.body ?? {}) as { email?: unknown; name?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
  if (!isAccountEmail(email)) return { failure: "A valid email address is required." };
  const name = typeof body.name === "string" ? cleanText(body.name) : "";
  if (name.length === 0) return { failure: "Name is required." };
  if (typeof body.password !== "string" || passwordLengthFailure(body.password)) {
    return { failure: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.` };
  }
  return { value: { email, name, password: body.password } };
}
