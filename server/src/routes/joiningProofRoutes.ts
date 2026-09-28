import { allowsPasswordSignIn, allowsProviderSignIn, type AccountMode } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mintJoinEmailProofToken, verifyJoinEmailProofToken } from "../accounts/adminPort/joiningIntentSecrets";
import { readPrincipalEmail, recordPasswordEmailProof } from "../authConfig/federatedEmailProof";
import { resolveMailDeliveryCause } from "../authConfig/mailSender";
import type { Db } from "../db";
import { createJoiningProviderLifecycle } from "../accounts/adminPort/joiningProviderLifecycle";
import { completeExistingPolicyJoin } from "../accounts/adminPort/joiningAdmission";
import { createAccountFailure } from "../accounts/adminPort/failures";
import { createJoiningProviderIntent } from "../accounts/adminPort/joiningProviderIntent";
import { createJoiningProviderCallbacks } from "../accounts/adminPort/joiningProviderCallbacks";
import type { Auth } from "../auth";
import { resolveRequestClientIp } from "./appErrors";
import { toWebHeaders } from "./appRequestAdapters";

type Lifecycle = ReturnType<typeof createJoiningProviderLifecycle>;

interface Dependencies {
  db: Db;
  auth: Auth;
  applicationId: string;
  authMode: AccountMode;
  requireMfa: boolean;
  trustProxyHeaders: boolean;
  secret: string;
  publicUrl: URL;
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

function registerLifecycleRoutes(app: FastifyInstance, lifecycle: Lifecycle): void {
  app.get("/api/company-join/status", (req) => lifecycle.status(toWebHeaders(req.headers)));
  app.post("/api/company-join/cancel", (req, reply) => {
    const result = lifecycle.cancel(toWebHeaders(req.headers));
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

function requirePasswordPrincipal(req: FastifyRequest, input: Dependencies): string {
  if (!allowsPasswordSignIn(input.authMode)) invalid("Password joining is unavailable.");
  if (
    !req.accountActor ||
    (req.accountActor.assurance !== "password" && req.accountActor.assurance !== "mfa") ||
    (input.requireMfa && !req.accountActor.mfaSatisfied)
  ) {
    throw createAccountFailure("AUTHENTICATION_REQUIRED", "Sign in with your password and complete MFA to continue.");
  }
  return req.accountActor.principalId;
}

function requirePrincipalEmail(db: Db, principalId: string): string {
  const email = readPrincipalEmail(db, principalId);
  if (!email) invalid();
  return email;
}

function registerEmailProofSendRoute(app: FastifyInstance, input: Dependencies): void {
  app.post(
    "/api/accounts/:accountId/join/verify-email",
    { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } },
    (req, reply) =>
      respond(reply, input.fail, async () => {
        const principalId = requirePasswordPrincipal(req, input);
        if (!input.auth.mail) invalid("Email verification is unavailable.");
        if (Object.keys(bodyObject(req.body)).length !== 0) invalid();
        const email = requirePrincipalEmail(input.db, principalId);
        const token = mintJoinEmailProofToken(input.secret, {
          principalId,
          email,
          expiresAt: Date.now() + 60 * 60 * 1000,
        });
        const { accountId } = req.params as { accountId: string };
        const link = new URL("/join/" + encodeURIComponent(accountId) + "#verify=" + token, input.publicUrl);
        try {
          await input.auth.mail.send({
            to: email,
            subject: "Verify your email to join a company",
            text: `Open this link while signed in to verify your email and join the company. The link expires in 60 minutes.\n\n${link.href}`,
          });
        } catch (cause) {
          // Log only the redacted transport cause; never credentials, the link or the address.
          req.log.error({ cause: resolveMailDeliveryCause(cause) }, "Joining email verification delivery failed");
          throw createAccountFailure("DEPENDENCY_UNAVAILABLE", "Verification email could not be sent.");
        }
        return { sent: true };
      }),
  );
}

function registerEmailProofConfirmRoute(app: FastifyInstance, input: Dependencies): void {
  app.post("/api/company-join/verify-email", (req, reply) =>
    respond(reply, input.fail, () => {
      const principalId = requirePasswordPrincipal(req, input);
      const body = bodyObject(req.body);
      if (typeof body.token !== "string" || Object.keys(body).length !== 1) invalid();
      const proof = verifyJoinEmailProofToken(input.secret, body.token, Date.now());
      if (!proof || proof.principalId !== principalId) invalid();
      const email = requirePrincipalEmail(input.db, principalId);
      if (proof.email !== email) invalid();
      if (!recordPasswordEmailProof(input.db, principalId, email)) {
        // A policy refusal, not a server fault: this address would restrict an active Owner.
        throw createAccountFailure("FORBIDDEN", "This address cannot be verified for this account.");
      }
      return { ok: true };
    }),
  );
}

function registerCompletionRoutes(app: FastifyInstance, input: Dependencies): void {
  app.post("/api/accounts/:accountId/join/complete-existing", (req, reply) =>
    respond(reply, input.fail, () => {
      const principalId = requirePasswordPrincipal(req, input);
      const body = bodyObject(req.body);
      if (Object.keys(body).length !== 0) invalid();
      const { accountId } = req.params as { accountId: string };
      return completeExistingPolicyJoin({
        db: input.db,
        applicationId: input.applicationId,
        accountId,
        principalId,
        admissionId: req.id,
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
  const lifecycle = createJoiningProviderLifecycle({
    db: input.db,
    applicationId: input.applicationId,
    secureCookies: input.publicUrl.protocol === "https:",
  });
  registerMetadata(app, input);
  registerLifecycleRoutes(app, lifecycle);
  registerProviderRoutes(app, input);
  registerCompletionRoutes(app, input);
  registerEmailProofSendRoute(app, input);
  registerEmailProofConfirmRoute(app, input);
}
