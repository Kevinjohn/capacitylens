import type { FastifyInstance, FastifyReply } from "fastify";
import type { Auth } from "../auth";
import { MicrosoftProofError } from "../authConfig/microsoftProof";
import { toWebHeaders } from "./appRequestAdapters";
import { resolveRequestClientIp } from "./appErrors";
import { REPLY_ERRORS } from "./replyErrors";
import type { ParseResult } from "./routeShared";

type StartBody = {
  purpose?: unknown;
  email?: unknown;
  inviteToken?: unknown;
  accountId?: unknown;
  callbackURL?: unknown;
  errorCallbackURL?: unknown;
};

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof MicrosoftProofError) {
    return reply.code(error.status).send({ code: error.code, message: REPLY_ERRORS.microsoftConnectionFailed });
  }
  throw error;
}

interface StartRequest {
  purpose: "bootstrap" | "invite" | "link" | "join";
  email?: string;
  inviteToken?: string;
  accountId?: string;
  callbackURL: string;
  errorCallbackURL: string;
}

const invalidProofRequest = <T>(): ParseResult<T, MicrosoftProofError> => ({
  kind: "invalid",
  failure: new MicrosoftProofError("MICROSOFT_PROOF_REQUEST_INVALID", 400),
});

// eslint-disable-next-line complexity -- Validate all five untrusted wire fields before starting OAuth.
function parseStart(body: unknown): ParseResult<StartRequest, MicrosoftProofError> {
  const value = (body ?? {}) as StartBody;
  if (
    (value.purpose !== "bootstrap" &&
      value.purpose !== "invite" &&
      value.purpose !== "link" &&
      value.purpose !== "join") ||
    typeof value.callbackURL !== "string" ||
    typeof value.errorCallbackURL !== "string" ||
    (value.email !== undefined && typeof value.email !== "string") ||
    (value.inviteToken !== undefined && typeof value.inviteToken !== "string") ||
    (value.accountId !== undefined && typeof value.accountId !== "string")
  ) {
    return invalidProofRequest();
  }
  return {
    kind: "parsed",
    value: {
      purpose: value.purpose,
      callbackURL: value.callbackURL,
      errorCallbackURL: value.errorCallbackURL,
      ...(typeof value.email === "string" ? { email: value.email } : {}),
      ...(typeof value.inviteToken === "string" ? { inviteToken: value.inviteToken } : {}),
      ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    },
  };
}

function parseConfirmToken(body: unknown): ParseResult<string | undefined, MicrosoftProofError> {
  const { token } = (body ?? {}) as { token?: unknown };
  if (token !== undefined && typeof token !== "string") return invalidProofRequest();
  return { kind: "parsed", value: token };
}

type RegisterMicrosoftProofRoutesOptions = { app: FastifyInstance; auth: Auth; trustProxyHeaders?: boolean };
export function registerMicrosoftProofRoutes({
  app,
  auth,
  trustProxyHeaders = false,
}: RegisterMicrosoftProofRoutesOptions): void {
  const proof = auth.microsoftProof;
  if (!proof) return;
  app.post("/api/account/microsoft/start", async (req, reply) => {
    const parsed = parseStart(req.body);
    if (parsed.kind === "invalid") return sendError(reply, parsed.failure);
    try {
      const result = await proof.start({
        body: parsed.value,
        headers: toWebHeaders(req.headers),
        sourceIp: resolveRequestClientIp({ request: req, trustProxyHeaders }),
      });
      return reply.code(200).header("set-cookie", result.setCookies).send({ url: result.url });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.get("/api/account/microsoft/status", (req, reply) =>
    reply.code(200).send(proof.status(toWebHeaders(req.headers))),
  );
  app.post("/api/account/microsoft/confirm", async (req, reply) => {
    const parsed = parseConfirmToken(req.body);
    if (parsed.kind === "invalid") return sendError(reply, parsed.failure);
    try {
      const result = await proof.confirm(toWebHeaders(req.headers), parsed.value);
      return reply.code(200).header("set-cookie", result.setCookies).send({ url: result.url });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/api/account/microsoft/resend", async (req, reply) => {
    try {
      await proof.resend(toWebHeaders(req.headers));
      return reply.code(200).send({ ok: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/api/account/microsoft/cancel", (req, reply) =>
    reply
      .code(200)
      .header("set-cookie", proof.cancel(toWebHeaders(req.headers)))
      .send({ ok: true }),
  );
}
