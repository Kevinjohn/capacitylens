import { allowsPasswordSignIn, allowsProviderSignIn, type AccountMode } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db";
import { createJoiningProof } from "../accounts/adminPort/joiningProof";
import type { LocalIdentityPort } from "../accounts/identityPort/contracts";
import { resolveRequestClientIp } from "./appErrors";
import { toWebHeaders } from "./appRequestAdapters";

type Proof = ReturnType<typeof createJoiningProof>;

interface Dependencies {
  db: Db;
  identity: LocalIdentityPort;
  applicationId: string;
  authMode: AccountMode;
  requireMfa: boolean;
  trustProxyHeaders: boolean;
  secret: string;
  publicUrl: URL;
  sendMail: (email: string, token: string, accountId: string) => Promise<void>;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

function invalid(message = "Invalid company joining request."): never {
  throw new AccountContractError({ code: "VALIDATION_FAILED", message, retryable: false });
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function optionalInvitation(body: Record<string, unknown>): string | undefined {
  if (body.invitationToken === undefined) return undefined;
  if (typeof body.invitationToken !== "string" || body.invitationToken.length === 0) invalid();
  return body.invitationToken;
}

function respond<T>(reply: FastifyReply, fail: Dependencies["fail"], operation: () => Promise<T> | T) {
  return Promise.resolve().then(operation).catch((error: unknown) => fail(reply, error));
}

function registerMetadata(app: FastifyInstance, input: Dependencies): void {
  app.get("/api/accounts/:accountId/join/metadata", (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    const row = input.db.prepare("SELECT name FROM accounts WHERE id = ?").get(accountId) as { name: string } | undefined;
    if (!row) return input.fail(reply, new AccountContractError({
      code: "NOT_FOUND", message: "This company is unavailable.", retryable: false,
    }));
    return {
      accountId,
      companyName: row.name,
      passwordAvailable: allowsPasswordSignIn(input.authMode),
      providerAvailable: allowsProviderSignIn(input.authMode),
    };
  });
}

function registerMailRoutes(app: FastifyInstance, input: Dependencies, proof: Proof): void {
  app.post("/api/accounts/:accountId/join/start", (req: FastifyRequest, reply) =>
    respond(reply, input.fail, async () => {
      if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
      const body = bodyObject(req.body);
      if (typeof body.email !== "string" || (body.purpose !== "policy" && body.purpose !== "invitation")) invalid();
      const { accountId } = req.params as { accountId: string };
      const invitationToken = optionalInvitation(body);
      const result = await proof.start({
        accountId, email: body.email, purpose: body.purpose,
        ...(invitationToken === undefined ? {} : { invitationToken }),
        headers: toWebHeaders(req.headers),
        sourceIp: resolveRequestClientIp({ request: req, trustProxyHeaders: input.trustProxyHeaders }),
      });
      reply.header("set-cookie", result.setCookies);
      return { emailHint: result.emailHint, expiresAt: result.expiresAt,
        deliveryUnavailable: result.deliveryUnavailable };
    }));
  app.get("/api/company-join/status", (req) => proof.status(toWebHeaders(req.headers)));
  app.post("/api/company-join/resend", (req, reply) =>
    respond(reply, input.fail, () => proof.resend(toWebHeaders(req.headers))));
  app.post("/api/company-join/confirm", (req, reply) =>
    respond(reply, input.fail, () => {
      const body = bodyObject(req.body);
      if (typeof body.token !== "string") invalid();
      return proof.confirm(toWebHeaders(req.headers), body.token);
    }));
  app.post("/api/company-join/cancel", (req, reply) => {
    const result = proof.cancel(toWebHeaders(req.headers));
    reply.header("set-cookie", result.setCookie);
    return { ok: true };
  });
}

function registerCompletionRoutes(app: FastifyInstance, input: Dependencies, proof: Proof): void {
  app.post("/api/company-join/complete-password", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
      const body = bodyObject(req.body);
      if (typeof body.displayName !== "string" || typeof body.password !== "string") invalid();
      const invitationToken = optionalInvitation(body);
      return proof.completeNew({ headers: toWebHeaders(req.headers), displayName: body.displayName,
        password: body.password, ...(invitationToken === undefined ? {} : { invitationToken }) });
    }));
  app.post("/api/company-join/complete-existing", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!req.accountActor) invalid("Sign in as the addressed identity to continue.");
      const body = bodyObject(req.body);
      const invitationToken = optionalInvitation(body);
      return proof.completeExisting({ headers: toWebHeaders(req.headers), actor: req.accountActor,
        ...(invitationToken === undefined ? {} : { invitationToken }) });
    }));
}

export function registerJoiningProofRoutes(app: FastifyInstance, input: Dependencies): void {
  const proof = createJoiningProof({
    db: input.db, identity: input.identity, applicationId: input.applicationId,
    secret: input.secret, secureCookies: input.publicUrl.protocol === "https:",
    requireMfa: input.requireMfa, sendMail: input.sendMail,
  });
  registerMetadata(app, input);
  registerMailRoutes(app, input, proof);
  registerCompletionRoutes(app, input, proof);
}
