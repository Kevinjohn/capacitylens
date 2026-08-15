import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { SsoReadinessReason } from "@capacitylens/shared/account/ssoCutover";
import type { Auth, AuthMode } from "../auth";
import type { SsoCutoverIdentityPort } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort } from "./sqliteAccountAdminPort";
import { ssoCutoverReadiness } from "./ssoCutover";

/** The 400 "no strict provider" guard shared byte-for-byte by the two write endpoints below (email
 *  correction, federated-link removal). Distinct from the 404 variant on GET /api/identity/provider
 *  and the pre-derived check inside sso-readiness — those are left untouched. Sends the response and
 *  returns undefined on failure so a call site that needs the provider can use it directly; neither
 *  current call site does, so both just test the return value. */
function requireStrictProvider(auth: Auth, reply: FastifyReply): Auth["strictProvider"] | undefined {
  if (!auth.strictProvider) {
    reply.code(400).send({ error: "No strict OIDC provider is configured." });
    return undefined;
  }
  return auth.strictProvider;
}

interface SsoCutoverRouteDependencies {
  auth: Auth;
  authMode: Exclude<AuthMode, "off">;
  identity: SsoCutoverIdentityPort;
  administration: SsoCutoverAccountAdminPort;
  applicationId: string;
  openSignup: boolean;
  authorize(req: FastifyRequest, reply: FastifyReply, accountId: string, action: "manageMembers"): boolean;
  fail(reply: FastifyReply, error: unknown): unknown;
  toWebHeaders(headers: FastifyRequest["headers"]): Headers;
}

/** Register the authenticated provider-link and cutover-repair HTTP adapter. Provider lifecycle,
 * readiness policy, and storage remain behind their dedicated domain/port seams. */
export function registerSsoCutoverRoutes(app: FastifyInstance, dependencies: SsoCutoverRouteDependencies): void {
  const { auth, authMode, identity, administration, applicationId, openSignup, authorize, fail, toWebHeaders } =
    dependencies;

  app.get("/api/identity/provider", async (req, reply) => {
    const provider = auth.strictProvider;
    if (!provider) return reply.code(404).send({ error: "No strict OIDC provider is configured." });
    try {
      const links = identity.inspectProviderLinks(req.user!.id, provider.id);
      return {
        provider,
        connected: links.length > 0,
        verified: links.length === 1 && links[0]!.verified,
      };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/identity/link-provider", async (req, reply) => {
    if (!req.accountActor?.fresh) {
      return fail(
        reply,
        new AccountContractError({
          code: "SESSION_NOT_FRESH",
          message: "A fresh sign-in is required to connect an identity provider.",
          retryable: false,
        }),
      );
    }
    const body = (req.body ?? {}) as { callbackURL?: unknown; errorCallbackURL?: unknown };
    if (typeof body.callbackURL !== "string" || typeof body.errorCallbackURL !== "string") {
      return reply.code(400).send({ error: "Valid callback and error return URLs are required." });
    }
    try {
      const result = await auth.beginFederatedLink!({
        headers: toWebHeaders(req.headers),
        principalId: req.accountActor.principalId,
        callbackURL: body.callbackURL,
        errorCallbackURL: body.errorCallbackURL,
      });
      if (result.setCookies.length > 0) reply.header("set-cookie", result.setCookies);
      return { url: result.url };
    } catch (error) {
      const body =
        error && typeof error === "object" && (error as { body?: unknown }).body
          ? (error as { body: { code?: unknown; message?: unknown } }).body
          : null;
      const code = body && typeof body.code === "string" ? body.code : null;
      const message = body && typeof body.message === "string" ? body.message : null;
      if (code === "SESSION_EXPIRED") return reply.code(401).send({ error: message, code });
      if (code === "INVALID_CALLBACK_URL" || code === "PROVIDER_NOT_FOUND") {
        return reply.code(400).send({ error: message, code });
      }
      if (["PROVIDER_ALREADY_LINKED", "MULTIPLE_PROVIDER_LINKS"].includes(code ?? "")) {
        return reply.code(409).send({ error: message, code });
      }
      if (code === "PROVIDER_UNAVAILABLE") return reply.code(502).send({ error: message, code });
      req.log.error(error, "identity provider link initiation failed");
      return reply.code(500).send({ error: "The identity-provider connection could not be started." });
    }
  });

  app.get("/api/accounts/:accountId/sso-readiness", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    const provider = auth.strictProvider;
    if (!provider) return reply.code(400).send({ error: "No strict OIDC provider is configured." });
    try {
      const readiness = ssoCutoverReadiness({
        provider,
        providers: auth.providers,
        identity,
        administration,
        openSignup,
      });
      const workspace = readiness.workspaces.find((candidate) => candidate.workspaceId === accountId);
      if (!workspace) return reply.code(404).send({ error: "The workspace does not exist." });
      const safeGlobalIssues = readiness.issues.filter(
        (issue) => issue.workspaceId === null && issue.principalId === null,
      );
      const restrictedIdentityIssues = readiness.issues.some(
        (issue) => issue.blocking && issue.workspaceId === null && issue.principalId !== null,
      );
      const otherWorkspaceIssues = readiness.issues.some(
        (issue) => issue.blocking && issue.workspaceId !== null && issue.workspaceId !== accountId,
      );
      return {
        ...workspace,
        ready: readiness.ready,
        provider,
        globalIssues: [
          ...safeGlobalIssues,
          ...(restrictedIdentityIssues
            ? [
                {
                  reason: "operator_identity_repair_required" satisfies SsoReadinessReason,
                  message: "Installation-wide identity repair is required; run the operator preflight for details.",
                  blocking: true,
                  critical: true,
                  workspaceId: null,
                  principalId: null,
                },
              ]
            : []),
          ...(otherWorkspaceIssues
            ? [
                {
                  reason: "other_workspace_not_ready" satisfies SsoReadinessReason,
                  message: "Another company has cutover blockers; run the operator preflight for details.",
                  blocking: true,
                  critical: true,
                  workspaceId: null,
                  principalId: null,
                },
              ]
            : []),
        ],
      };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch("/api/accounts/:accountId/members/:userId/email", async (req, reply) => {
    const { accountId, userId } = req.params as { accountId: string; userId: string };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode !== "password") {
      return reply.code(409).send({
        error: "Sign-in email correction is available only during mixed-mode SSO staging.",
        code: "CONFLICT",
      });
    }
    if (!requireStrictProvider(auth, reply)) return;
    const body = (req.body ?? {}) as { email?: unknown };
    const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
    if (!isAccountEmail(email)) return reply.code(400).send({ error: "A valid email address is required." });
    try {
      const authority = await administration.evaluateIdentityAdminAuthority({
        actor: req.accountActor!,
        targetPrincipalId: userId,
        action: "correct-email",
      });
      if (!authority.allowed) {
        throw new AccountContractError({
          code: "FORBIDDEN",
          message: "You lack identity-global authority to correct this email address.",
          retryable: false,
        });
      }
      const occurredAt = new Date().toISOString();
      await identity.correctPrincipalEmail({
        principalId: userId,
        email,
        authorizeInTransaction: () =>
          administration.assertIdentityRepairAuthorityInTx({
            actor: req.accountActor!,
            workspaceId: accountId,
            targetPrincipalId: userId,
            action: "correct-email",
            expectedRevision: authority.revision,
          }),
        audit: {
          id: `identity-email:${userId}:${occurredAt}`,
          occurredAt,
          applicationId,
          workspaceId: accountId,
          actorPrincipalId: req.accountActor!.principalId,
          targetPrincipalId: userId,
          commandId: null,
          action: "identity.email_corrected",
          outcome: "success",
          changedFields: ["email", "sessions"],
        },
      });
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete("/api/accounts/:accountId/members/:userId/federated-link", async (req, reply) => {
    const { accountId, userId } = req.params as { accountId: string; userId: string };
    if (!authorize(req, reply, accountId, "manageMembers")) return;
    if (authMode !== "password") {
      return reply.code(409).send({
        error: "The required provider cannot be removed while SSO-only mode is active.",
        code: "CONFLICT",
      });
    }
    if (!requireStrictProvider(auth, reply)) return;
    const body = (req.body ?? {}) as { rowId?: unknown; providerId?: unknown; subject?: unknown };
    if (
      typeof body.rowId !== "string" ||
      body.rowId.length === 0 ||
      typeof body.providerId !== "string" ||
      body.providerId.length === 0 ||
      body.providerId === "credential" ||
      typeof body.subject !== "string" ||
      body.subject.length === 0
    ) {
      return reply.code(400).send({ error: "An exact provider-link coordinate is required." });
    }
    try {
      const authority = await administration.evaluateIdentityAdminAuthority({
        actor: req.accountActor!,
        targetPrincipalId: userId,
        action: "remove-federated-link",
      });
      if (!authority.allowed) {
        throw new AccountContractError({
          code: "FORBIDDEN",
          message: "You lack identity-global authority to repair this provider link.",
          retryable: false,
        });
      }
      const occurredAt = new Date().toISOString();
      const removed = await identity.removeFederatedLink({
        principalId: userId,
        providerId: body.providerId,
        rowId: body.rowId,
        subject: body.subject,
        authorizeInTransaction: () =>
          administration.assertIdentityRepairAuthorityInTx({
            actor: req.accountActor!,
            workspaceId: accountId,
            targetPrincipalId: userId,
            action: "remove-federated-link",
            expectedRevision: authority.revision,
          }),
        audit: {
          id: `identity-unlink:${body.rowId}:${occurredAt}`,
          occurredAt,
          applicationId,
          workspaceId: accountId,
          actorPrincipalId: req.accountActor!.principalId,
          targetPrincipalId: userId,
          commandId: null,
          action: "identity.federated_link_removed",
          outcome: "success",
          changedFields: ["federatedIdentity", "sessions"],
        },
      });
      if (!removed) {
        throw new AccountContractError({
          code: "CONFLICT",
          message: "The provider link changed after it was inspected. Refresh and try again.",
          retryable: false,
        });
      }
      return reply.code(204).send();
    } catch (error) {
      return fail(reply, error);
    }
  });
}
