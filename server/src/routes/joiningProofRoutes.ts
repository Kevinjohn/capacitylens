import { allowsPasswordSignIn, allowsProviderSignIn } from "@capacitylens/shared/account/types";
import type { AccountMode } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mintJoinEmailProofToken, verifyJoinEmailProofToken } from "../accounts/adminPort/joiningIntentSecrets";
import { readPrincipalEmail, recordPasswordEmailProof } from "../authConfig/federatedEmailProof";
import { MailBudgetExceededError, resolveMailDeliveryCause } from "../authConfig/mailSender";
import type { MailSender } from "../authConfig/mailSender";
import type { Db } from "../db";
import { createJoiningProviderLifecycle } from "../accounts/adminPort/joiningProviderLifecycle";
import { completeExistingPolicyJoin } from "../accounts/adminPort/joiningAdmission";
import { createAccountFailure } from "../accounts/adminPort/failures";
import { createJoiningProviderIntent } from "../accounts/adminPort/joiningProviderIntent";
import { createJoiningProviderCallbacks } from "../accounts/adminPort/joiningProviderCallbacks";
import type { Auth } from "../auth";
import { resolveRequestClientIp } from "./appErrors";
import { toWebHeaders } from "./appRequestAdapters";
import { REPLY_ERRORS } from "./replyErrors";
import type { ParseResult } from "./routeShared";

type Lifecycle = ReturnType<typeof createJoiningProviderLifecycle>;

interface Dependencies {
  db: Db;
  auth: Auth;
  /** The budgeted sender; null when mail is not configured. */
  mail: MailSender | null;
  applicationId: string;
  authMode: AccountMode;
  trustProxyHeaders: boolean;
  secret: string;
  publicUrl: URL;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

interface JoiningAccountRoute {
  Params: { accountId: string };
}

type BodyResult<T> = ParseResult<T, AccountContractError>;

function createInvalidRequest(message: string = REPLY_ERRORS.joiningRequestInvalid): AccountContractError {
  return new AccountContractError({ code: "VALIDATION_FAILED", message, retryable: false });
}

/** Refuse a request whose mode, session or proof does not permit joining; `respond` replies. */
function invalid(message?: string): never {
  throw createInvalidRequest(message);
}

const rejectBody = <T>(): BodyResult<T> => ({ kind: "invalid", failure: createInvalidRequest() });

function parseBodyObject(value: unknown): BodyResult<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return rejectBody();
  return { kind: "parsed", value: value as Record<string, unknown> };
}

function parseEmptyBody(value: unknown): BodyResult<true> {
  const body = parseBodyObject(value);
  if (body.kind === "invalid") return body;
  return Object.keys(body.value).length === 0 ? { kind: "parsed", value: true } : rejectBody();
}

function parseOptionalInvitation(value: unknown): BodyResult<string | undefined> {
  const body = parseBodyObject(value);
  if (body.kind === "invalid") return body;
  const { invitationToken } = body.value;
  if (invitationToken === undefined) return { kind: "parsed", value: undefined };
  if (typeof invitationToken !== "string" || invitationToken.length === 0) return rejectBody();
  return { kind: "parsed", value: invitationToken };
}

interface ProviderStartBody {
  email: string;
  purpose: "policy" | "invitation";
  providerId: "google" | "github";
}

function parseProviderStartBody(value: unknown): BodyResult<ProviderStartBody> {
  const body = parseBodyObject(value);
  if (body.kind === "invalid") return body;
  const { email, purpose, providerId } = body.value;
  if (
    typeof email !== "string" ||
    (purpose !== "policy" && purpose !== "invitation") ||
    (providerId !== "google" && providerId !== "github")
  )
    return rejectBody();
  return { kind: "parsed", value: { email, purpose, providerId } };
}

function parseProofToken(value: unknown): BodyResult<string> {
  const body = parseBodyObject(value);
  if (body.kind === "invalid") return body;
  if (typeof body.value.token !== "string" || Object.keys(body.value).length !== 1) return rejectBody();
  return { kind: "parsed", value: body.value.token };
}

function respond<T>(reply: FastifyReply, fail: Dependencies["fail"], operation: () => Promise<T> | T) {
  return Promise.resolve()
    .then(operation)
    .catch((error: unknown) => fail(reply, error));
}

function registerMetadata(app: FastifyInstance, input: Dependencies): void {
  app.get<JoiningAccountRoute>("/api/accounts/:accountId/join/metadata", (req, reply) => {
    const { accountId } = req.params;
    const row = input.db.prepare("SELECT name FROM accounts WHERE id = ?").get(accountId) as
      { name: string } | undefined;
    if (!row)
      return input.fail(
        reply,
        new AccountContractError({
          code: "NOT_FOUND",
          message: REPLY_ERRORS.joiningCompanyUnavailable,
          retryable: false,
        }),
      );
    return reply.code(200).send({
      accountId,
      companyName: row.name,
      passwordAvailable: allowsPasswordSignIn(input.authMode),
      providerAvailable: allowsProviderSignIn(input.authMode),
      // Only offer the verification link where the send route can deliver it.
      emailVerificationAvailable: allowsPasswordSignIn(input.authMode) && input.mail != null,
    });
  });
}

function registerLifecycleRoutes(app: FastifyInstance, lifecycle: Lifecycle): void {
  app.get("/api/company-join/status", (req, reply) =>
    reply.code(200).send(lifecycle.status(toWebHeaders(req.headers))),
  );
  app.post("/api/company-join/cancel", (req, reply) => {
    const result = lifecycle.cancel(toWebHeaders(req.headers));
    return reply.code(200).header("set-cookie", result.setCookie).send({ ok: true });
  });
}

async function startProviderOAuth(args: {
  input: Dependencies;
  req: FastifyRequest;
  providerId: "google" | "github";
  callbackURL: string;
  errorCallbackURL: string;
}): Promise<{ url: string; setCookies: string[] }> {
  const { input, req, providerId, callbackURL, errorCallbackURL } = args;
  const headers = toWebHeaders(req.headers);
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
      message: REPLY_ERRORS.joiningProviderStartFailed,
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
  app.post<JoiningAccountRoute>("/api/accounts/:accountId/join/provider/start", (req, reply) =>
    respond(reply, input.fail, async () => {
      if (!allowsProviderSignIn(input.authMode)) invalid(REPLY_ERRORS.joiningProviderUnavailable);
      const parsed = parseProviderStartBody(req.body);
      if (parsed.kind === "invalid") return input.fail(reply, parsed.failure);
      const body = parsed.value;
      const providerId = body.providerId;
      if (
        !input.auth.providers.some((provider) => provider.id === providerId) ||
        (input.authMode === "sso-only" && !input.auth.permittedCompanyProviderIds?.has(providerId))
      ) {
        invalid(REPLY_ERRORS.joiningProviderNotPermitted);
      }
      const { accountId } = req.params;
      const invitation = parseOptionalInvitation(req.body);
      if (invitation.kind === "invalid") return input.fail(reply, invitation.failure);
      const invitationToken = invitation.value;
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
          startProviderOAuth({ input, req, providerId, callbackURL, errorCallbackURL }),
      });
      return reply
        .code(200)
        .header("set-cookie", result.setCookies)
        .send({ url: result.url, emailHint: result.emailHint });
    }),
  );
}

function requirePasswordPrincipal(req: FastifyRequest, input: Dependencies): string {
  if (!allowsPasswordSignIn(input.authMode)) invalid(REPLY_ERRORS.joiningPasswordUnavailable);
  if (!req.accountActor || req.accountActor.assurance !== "password") {
    throw createAccountFailure("AUTHENTICATION_REQUIRED", REPLY_ERRORS.joiningPasswordSignInRequired);
  }
  return req.accountActor.principalId;
}

function requirePrincipalEmail(db: Db, principalId: string): string {
  const email = readPrincipalEmail(db, principalId);
  if (!email) invalid();
  return email;
}

function registerEmailProofSendRoute(app: FastifyInstance, input: Dependencies): void {
  app.post<JoiningAccountRoute>(
    "/api/accounts/:accountId/join/verify-email",
    { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } },
    (req, reply) =>
      respond(reply, input.fail, async () => {
        const principalId = requirePasswordPrincipal(req, input);
        const mail = input.mail;
        if (!mail) invalid(REPLY_ERRORS.joiningEmailVerificationUnavailable);
        const empty = parseEmptyBody(req.body);
        if (empty.kind === "invalid") return input.fail(reply, empty.failure);
        const email = requirePrincipalEmail(input.db, principalId);
        const token = mintJoinEmailProofToken(input.secret, {
          principalId,
          email,
          expiresAt: Date.now() + 60 * 60 * 1000,
        });
        const { accountId } = req.params;
        const link = new URL("/join/" + encodeURIComponent(accountId) + "#verify=" + token, input.publicUrl);
        try {
          await mail.send({
            to: email,
            subject: "Verify your email to join a company",
            text: `Open this link while signed in to verify your email and join the company. The link expires in 60 minutes.\n\n${link.href}`,
          });
        } catch (cause) {
          if (cause instanceof MailBudgetExceededError) {
            throw createAccountFailure("RATE_LIMITED", REPLY_ERRORS.joiningVerificationEmailsLimited);
          }
          // Log only the redacted transport cause; never credentials, the link or the address.
          req.log.error({ cause: resolveMailDeliveryCause(cause) }, "Joining email verification delivery failed");
          throw createAccountFailure("DEPENDENCY_UNAVAILABLE", REPLY_ERRORS.joiningVerificationEmailFailed);
        }
        return reply.code(200).send({ sent: true });
      }),
  );
}

function registerEmailProofConfirmRoute(app: FastifyInstance, input: Dependencies): void {
  app.post("/api/company-join/verify-email", (req, reply) =>
    respond(reply, input.fail, () => {
      const principalId = requirePasswordPrincipal(req, input);
      const token = parseProofToken(req.body);
      if (token.kind === "invalid") return input.fail(reply, token.failure);
      const proof = verifyJoinEmailProofToken(input.secret, token.value, Date.now());
      if (!proof || proof.principalId !== principalId) invalid();
      const email = requirePrincipalEmail(input.db, principalId);
      if (proof.email !== email) invalid();
      if (!recordPasswordEmailProof(input.db, principalId, email)) {
        // A policy refusal, not a server fault: this address would restrict an active Owner.
        throw createAccountFailure("FORBIDDEN", REPLY_ERRORS.joiningAddressNotVerifiable);
      }
      return reply.code(200).send({ ok: true });
    }),
  );
}

function registerCompletionRoutes(app: FastifyInstance, input: Dependencies): void {
  app.post<JoiningAccountRoute>("/api/accounts/:accountId/join/complete-existing", (req, reply) =>
    respond(reply, input.fail, () => {
      const principalId = requirePasswordPrincipal(req, input);
      const empty = parseEmptyBody(req.body);
      if (empty.kind === "invalid") return input.fail(reply, empty.failure);
      const { accountId } = req.params;
      return reply.code(200).send(
        completeExistingPolicyJoin({
          db: input.db,
          applicationId: input.applicationId,
          accountId,
          principalId,
          admissionId: req.id,
        }),
      );
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
      if (!req.accountActor) invalid(REPLY_ERRORS.joiningVerifiedProviderRequired);
      if (
        !req.authenticationProviderId ||
        !input.auth.providers.some((candidate) => candidate.id === req.authenticationProviderId) ||
        (input.authMode === "sso-only" && !input.auth.permittedCompanyProviderIds?.has(req.authenticationProviderId))
      ) {
        invalid(REPLY_ERRORS.joiningProviderNotPermitted);
      }
      const invitation = parseOptionalInvitation(req.body);
      if (invitation.kind === "invalid") return input.fail(reply, invitation.failure);
      const invitationToken = invitation.value;
      return reply.code(200).send(
        provider.complete({
          headers: toWebHeaders(req.headers),
          actor: req.accountActor,
          providerId: req.authenticationProviderId,
          ...(invitationToken === undefined ? {} : { invitationToken }),
        }),
      );
    }),
  );
  registerMicrosoftCompletion(app, input);
}

function registerMicrosoftCompletion(app: FastifyInstance, input: Dependencies): void {
  app.post("/api/company-join/complete-microsoft", (req, reply) =>
    respond(reply, input.fail, () => {
      if (!req.accountActor || !input.auth.microsoftProof || req.authenticationProviderId !== "microsoft") {
        invalid(REPLY_ERRORS.joiningMicrosoftRequired);
      }
      const invitation = parseOptionalInvitation(req.body);
      if (invitation.kind === "invalid") return input.fail(reply, invitation.failure);
      const invitationToken = invitation.value;
      return reply.code(200).send(
        input.auth.microsoftProof.completeJoining({
          headers: toWebHeaders(req.headers),
          actor: req.accountActor,
          providerId: req.authenticationProviderId,
          ...(invitationToken === undefined ? {} : { invitationToken }),
        }),
      );
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
