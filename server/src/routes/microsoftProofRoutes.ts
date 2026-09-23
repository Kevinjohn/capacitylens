import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Auth } from "../auth";
import { MicrosoftProofError } from "../authConfig/microsoftProof";
import { toWebHeaders } from "./appRequestAdapters";
import { resolveRequestClientIp } from "./appErrors";

type StartBody = {
  purpose?: unknown;
  email?: unknown;
  inviteToken?: unknown;
  callbackURL?: unknown;
  errorCallbackURL?: unknown;
};

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof MicrosoftProofError) {
    return reply.code(error.status).send({ code: error.code, message: "Microsoft connection could not continue." });
  }
  throw error;
}

// eslint-disable-next-line complexity -- Validate all five untrusted wire fields before starting OAuth.
function parseStart(body: unknown): {
  purpose: "bootstrap" | "invite" | "link";
  email?: string;
  inviteToken?: string;
  callbackURL: string;
  errorCallbackURL: string;
} {
  const value = (body ?? {}) as StartBody;
  if (
    (value.purpose !== "bootstrap" && value.purpose !== "invite" && value.purpose !== "link") ||
    typeof value.callbackURL !== "string" ||
    typeof value.errorCallbackURL !== "string" ||
    (value.email !== undefined && typeof value.email !== "string") ||
    (value.inviteToken !== undefined && typeof value.inviteToken !== "string")
  ) {
    throw new MicrosoftProofError("MICROSOFT_PROOF_REQUEST_INVALID", 400);
  }
  return {
    purpose: value.purpose,
    callbackURL: value.callbackURL,
    errorCallbackURL: value.errorCallbackURL,
    ...(typeof value.email === "string" ? { email: value.email } : {}),
    ...(typeof value.inviteToken === "string" ? { inviteToken: value.inviteToken } : {}),
  };
}

export function registerMicrosoftProofRoutes(app: FastifyInstance, auth: Auth, trustProxyHeaders = false): void {
  const proof = auth.microsoftProof;
  if (!proof) return;
  app.post("/api/account/microsoft/start", async (req: FastifyRequest, reply) => {
    try {
      const result = await proof.start({
        body: parseStart(req.body),
        headers: toWebHeaders(req.headers),
        sourceIp: resolveRequestClientIp({ request: req, trustProxyHeaders }),
      });
      reply.header("set-cookie", result.setCookies);
      return { url: result.url };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get("/api/account/microsoft/status", (req: FastifyRequest) => proof.status(toWebHeaders(req.headers)));
  app.post("/api/account/microsoft/confirm", async (req: FastifyRequest, reply) => {
    try {
      const body = (req.body ?? {}) as { token?: unknown };
      if (body.token !== undefined && typeof body.token !== "string")
        throw new MicrosoftProofError("MICROSOFT_PROOF_REQUEST_INVALID", 400);
      const result = await proof.confirm(toWebHeaders(req.headers), body.token);
      reply.header("set-cookie", result.setCookies);
      return { url: result.url };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/api/account/microsoft/resend", async (req: FastifyRequest, reply) => {
    try {
      await proof.resend(toWebHeaders(req.headers));
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/api/account/microsoft/cancel", (req: FastifyRequest, reply) => {
    reply.header("set-cookie", proof.cancel(toWebHeaders(req.headers)));
    return { ok: true };
  });
}
