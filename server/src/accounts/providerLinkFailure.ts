import type { FastifyReply, FastifyRequest } from "fastify";
import { MicrosoftProofError } from "../authConfig/microsoftProof";

const providerLinkFailureStatuses = new Map([
  ["SESSION_EXPIRED", 401],
  ["INVALID_CALLBACK_URL", 400],
  ["PROVIDER_NOT_FOUND", 400],
  ["PROVIDER_ALREADY_LINKED", 409],
  ["MULTIPLE_PROVIDER_LINKS", 409],
  ["PROVIDER_UNAVAILABLE", 502],
  ["MICROSOFT_PROOF_REQUIRED", 400],
]);

export function providerLinkBodyError(body: {
  callbackURL?: unknown;
  errorCallbackURL?: unknown;
  providerId?: unknown;
}): string | null {
  if (typeof body.callbackURL !== "string" || typeof body.errorCallbackURL !== "string") {
    return "Valid callback and error return URLs are required.";
  }
  if (body.providerId !== undefined && typeof body.providerId !== "string") return "A valid provider id is required.";
  return null;
}

export function sendProviderLinkFailure(req: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof MicrosoftProofError)
    return reply.code(error.status).send({ error: error.code, code: error.code });
  const body =
    error && typeof error === "object" && (error as { body?: unknown }).body
      ? (error as { body: { code?: unknown; message?: unknown } }).body
      : null;
  const code = body && typeof body.code === "string" ? body.code : null;
  const message = body && typeof body.message === "string" ? body.message : null;
  const status = code ? providerLinkFailureStatuses.get(code) : undefined;
  if (status) return reply.code(status).send({ error: message, code });
  req.log.error(error, "identity provider link initiation failed");
  return reply.code(500).send({ error: "The identity-provider connection could not be started." });
}
