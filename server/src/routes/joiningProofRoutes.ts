import { allowsPasswordSignIn, allowsProviderSignIn, type AccountMode } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db";
import { createJoiningProof } from "../accounts/adminPort/joiningProof";
import { createJoiningProviderIntent } from "../accounts/adminPort/joiningProviderIntent";
import { createJoiningProviderCallbacks } from "../accounts/adminPort/joiningProviderCallbacks";
import type { LocalIdentityPort } from "../accounts/identityPort/contracts";
import type { Auth } from "../auth";
import { resolveRequestClientIp } from "./appErrors";
import { toWebHeaders } from "./appRequestAdapters";

type Proof = ReturnType<typeof createJoiningProof>;

interface Dependencies {
  db: Db;
  identity: LocalIdentityPort;
  auth: Auth;
  applicationId: string;
  authMode: AccountMode;
  requireMfa: boolean;
  trustProxyHeaders: boolean;
  secret: string;
  publicUrl: URL;
  sendMail: (email: string, token: string, target: { accountId: string; invitationToken?: string }) => Promise<void>;
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
  return Promise.resolve()
    .then(operation)
    .catch((error: unknown) => fail(reply, error));
}

function registerMetadata(app: FastifyInstance, input: Dependencies): void {
  app.get("/api/accounts/:accountId/join/metadata", (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    const row = input.db.prepare("SELECT name FROM accounts WHERE id = ?").get(accountId) as
      { name: string } | undefined;
    if (!row)
      return input.fail(
        reply,
        new AccountContractError({
          code: "NOT_FOUND",
          message: "This company is unavailable.",
          retryable: false,
        }),
      );
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
        accountId,
        email: body.email,
        purpose: body.purpose,
        ...(invitationToken === undefined ? {} : { invitationToken }),
        headers: toWebHeaders(req.headers),
        sourceIp: resolveRequestClientIp({ request: req, trustProxyHeaders: input.trustProxyHeaders }),
      });
      reply.header("set-cookie", result.setCookies);
      return {
        emailHint: result.emailHint,
        expiresAt: result.expiresAt,
        deliveryUnavailable: result.deliveryUnavailable,
      };
    }),
  );
  app.get("/api/company-join/status", (req) => proof.status(toWebHeaders(req.headers)));
  app.post("/api/company-join/resend", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
      return proof.resend(toWebHeaders(req.headers), optionalInvitation(bodyObject(req.body ?? {})));
    }),
  );
  app.post("/api/company-join/confirm", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
      const body = bodyObject(req.body);
      if (typeof body.token !== "string") invalid();
      return proof.confirm(toWebHeaders(req.headers), body.token);
    }),
  );
  app.post("/api/company-join/cancel", (req, reply) => {
    const result = proof.cancel(toWebHeaders(req.headers));
    reply.header("set-cookie", result.setCookie);
    return { ok: true };
  });
}

async function startProviderOAuth(args: {
  input: Dependencies;
  request: FastifyRequest;
  providerId: "google" | "github";
  callbackURL: string;
  errorCallbackURL: string;
}): Promise<{ url: string; setCookies: string[] }> {
  const { input, request, providerId, callbackURL, errorCallbackURL } = args;
  const headers = toWebHeaders(request.headers);
  headers.set("content-type", "application/json");
  const response = await input.auth.handler(
    new Request(new URL("/api/auth/sign-in/social", input.publicUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: providerId, callbackURL, errorCallbackURL }),
    }),
  );
  const payload: unknown = await response.json().catch(() => null);
  const url = payload && typeof payload === "object" && "url" in payload ? payload.url : null;
  if (!response.ok || typeof url !== "string") {
    throw new AccountContractError({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Provider sign-in could not start.",
      retryable: true,
    });
  }
  return { url, setCookies: response.headers.getSetCookie() };
}

function registerProviderRoutes(app: FastifyInstance, input: Dependencies): void {
  const providerIntent = createJoiningProviderIntent({
    db: input.db,
    applicationId: input.applicationId,
    secret: input.secret,
    secureCookies: input.publicUrl.protocol === "https:",
  });
  app.post("/api/accounts/:accountId/join/provider/start", (req: FastifyRequest, reply) =>
    respond(reply, input.fail, async () => {
      if (!allowsProviderSignIn(input.authMode)) invalid("Provider joining is unavailable.");
      const body = bodyObject(req.body);
      if (
        typeof body.email !== "string" ||
        (body.purpose !== "policy" && body.purpose !== "invitation") ||
        (body.providerId !== "google" && body.providerId !== "github")
      )
        invalid();
      const providerId = body.providerId;
      if (
        !input.auth.providers.some((provider) => provider.id === providerId) ||
        (input.authMode === "sso-only" && !input.auth.permittedCompanyProviderIds?.has(providerId))
      ) {
        invalid("This provider is unavailable for company joining.");
      }
      const { accountId } = req.params as { accountId: string };
      const invitationToken = optionalInvitation(body);
      const result = await providerIntent.start({
        accountId,
        providerId,
        email: body.email,
        purpose: body.purpose,
        ...(invitationToken === undefined ? {} : { invitationToken }),
        headers: toWebHeaders(req.headers),
        sourceIp: resolveRequestClientIp({ request: req, trustProxyHeaders: input.trustProxyHeaders }),
        publicUrl: input.publicUrl,
        startOAuth: (callbackURL, errorCallbackURL) =>
          startProviderOAuth({ input, request: req, providerId, callbackURL, errorCallbackURL }),
      });
      reply.header("set-cookie", result.setCookies);
      return { url: result.url, emailHint: result.emailHint };
    }),
  );
}

function registerCompletionRoutes(app: FastifyInstance, input: Dependencies, proof: Proof): void {
  app.post("/api/company-join/complete-password", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
      const body = bodyObject(req.body);
      if (typeof body.displayName !== "string" || typeof body.password !== "string") invalid();
      const invitationToken = optionalInvitation(body);
      return proof.completeNew({
        headers: toWebHeaders(req.headers),
        displayName: body.displayName,
        password: body.password,
        ...(invitationToken === undefined ? {} : { invitationToken }),
      });
    }),
  );
  app.post("/api/company-join/complete-existing", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
      if (!req.accountActor) invalid("Sign in as the addressed identity to continue.");
      const body = bodyObject(req.body);
      const invitationToken = optionalInvitation(body);
      return proof.completeExisting({
        headers: toWebHeaders(req.headers),
        actor: req.accountActor,
        ...(invitationToken === undefined ? {} : { invitationToken }),
      });
    }),
  );
  const provider = createJoiningProviderCallbacks({
    db: input.db,
    applicationId: input.applicationId,
    secret: input.secret,
    secureCookies: input.publicUrl.protocol === "https:",
  });
  app.post("/api/company-join/complete-provider", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!req.accountActor) invalid("Sign in with the verified provider to continue.");
      if (
        !req.authenticationProviderId ||
        !input.auth.providers.some((candidate) => candidate.id === req.authenticationProviderId) ||
        (input.authMode === "sso-only" && !input.auth.permittedCompanyProviderIds?.has(req.authenticationProviderId))
      ) {
        invalid("This provider is unavailable for company joining.");
      }
      const invitationToken = optionalInvitation(bodyObject(req.body));
      return provider.complete({
        headers: toWebHeaders(req.headers),
        actor: req.accountActor,
        providerId: req.authenticationProviderId,
        requireMfa: input.requireMfa,
        ...(invitationToken === undefined ? {} : { invitationToken }),
      });
    }),
  );
  registerMicrosoftCompletion(app, input);
}

function registerMicrosoftCompletion(app: FastifyInstance, input: Dependencies): void {
  app.post("/api/company-join/complete-microsoft", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!req.accountActor || !input.auth.microsoftProof || req.authenticationProviderId !== "microsoft") {
        invalid("Sign in with Microsoft to continue.");
      }
      const invitationToken = optionalInvitation(bodyObject(req.body));
      return input.auth.microsoftProof.completeJoining({
        headers: toWebHeaders(req.headers),
        actor: req.accountActor,
        providerId: req.authenticationProviderId,
        requireMfa: input.requireMfa,
        ...(invitationToken === undefined ? {} : { invitationToken }),
      });
    }),
  );
}

export function registerJoiningProofRoutes(app: FastifyInstance, input: Dependencies): void {
  const proof = createJoiningProof({
    db: input.db,
    identity: input.identity,
    applicationId: input.applicationId,
    secret: input.secret,
    secureCookies: input.publicUrl.protocol === "https:",
    requireMfa: input.requireMfa,
    sendMail: input.sendMail,
  });
  registerMetadata(app, input);
  registerMailRoutes(app, input, proof);
  registerProviderRoutes(app, input);
  registerCompletionRoutes(app, input, proof);
}
