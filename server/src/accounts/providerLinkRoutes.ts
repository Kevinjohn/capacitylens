import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Auth } from "../auth";
import type { SsoCutoverIdentityPort } from "./identityPort/contracts";
import { providerLinkBodyError, sendProviderLinkFailure } from "./providerLinkFailure";
import { startMicrosoftProviderLink } from "./microsoftProviderLink";
import { requireAuthenticatedUser } from "./routes/handlers/authenticatedPrincipal";

type ProviderLinkIdentity = Pick<SsoCutoverIdentityPort, "inspectProviderLinks">;

interface ProviderRouteDependencies {
  auth: Auth;
  identity: ProviderLinkIdentity;
  fail(reply: FastifyReply, error: unknown): unknown;
  toWebHeaders(headers: FastifyRequest["headers"]): Headers;
  trustProxyHeaders?: boolean;
}
type RouteRequest = FastifyRequest;

function requireFederatedLink(auth: Auth): NonNullable<Auth["beginFederatedLink"]> {
  if (!auth.beginFederatedLink) throw new Error("Federated identity linking is not configured.");
  return auth.beginFederatedLink;
}

/** Registers authenticated self-service provider inspection and link initiation. */
export function registerProviderLinkRoutes(app: FastifyInstance, dependencies: ProviderRouteDependencies): void {
  const { auth, identity, fail } = dependencies;
  app.get("/api/identity/provider", async (req, reply) => {
    const requestedProviderId = (req.query as { providerId?: unknown } | undefined)?.providerId;
    if (requestedProviderId !== undefined && typeof requestedProviderId !== "string") {
      return reply.code(400).send({ error: "A valid provider id is required." });
    }
    const provider =
      requestedProviderId === undefined
        ? auth.defaultCompanyProvider
        : auth.providers.find((candidate) => candidate.id === requestedProviderId && !candidate.experimental);
    if (!provider) return reply.code(404).send({ error: "No configured company provider was found." });
    try {
      const links = identity.inspectProviderLinks(requireAuthenticatedUser(req).id, provider.id);
      return { provider, connected: links.length > 0, verified: links.length === 1 && links[0]?.verified === true };
    } catch (error) {
      // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
      return fail(reply, error);
    }
  });

  app.post("/api/identity/link-provider", async (req, reply) => beginProviderLink(req, reply, dependencies));
}

function resolveProviderLinkBody(
  body: { callbackURL?: unknown; errorCallbackURL?: unknown; providerId?: unknown },
  defaultProvider: Auth["defaultCompanyProvider"],
): { callbackURL: string; errorCallbackURL: string; providerId?: string } {
  const validBody = { ...body } as { callbackURL: string; errorCallbackURL: string; providerId?: string };
  if (validBody.providerId === undefined && defaultProvider) validBody.providerId = defaultProvider.id;
  return validBody;
}

async function beginProviderLink(req: RouteRequest, reply: FastifyReply, dependencies: ProviderRouteDependencies) {
  const { auth, fail, toWebHeaders } = dependencies;
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
  const body = (req.body ?? {}) as { callbackURL?: unknown; errorCallbackURL?: unknown; providerId?: unknown };
  const bodyError = providerLinkBodyError(body);
  if (bodyError) return reply.code(400).send({ error: bodyError });
  const validBody = resolveProviderLinkBody(body, auth.defaultCompanyProvider);
  if (validBody.providerId !== undefined && req.user?.emailVerified !== true) {
    return reply.code(403).send({
      error: "Verify the local account address before connecting an identity provider.",
      code: "LOCAL_EMAIL_NOT_VERIFIED",
    });
  }
  try {
    const headers = toWebHeaders(req.headers);
    const result =
      (await startMicrosoftProviderLink({
        auth,
        identity: dependencies.identity,
        request: req,
        body: validBody,
        headers,
        trustProxyHeaders: dependencies.trustProxyHeaders === true,
      })) ??
      (await requireFederatedLink(auth)({
        headers,
        principalId: req.accountActor.principalId,
        ...(validBody.providerId === undefined ? {} : { providerId: validBody.providerId }),
        callbackURL: validBody.callbackURL,
        errorCallbackURL: validBody.errorCallbackURL,
      }));
    if (result.setCookies.length > 0) reply.header("set-cookie", result.setCookies);
    return { url: result.url };
  } catch (error) {
    // Surface provider-link failures through the route boundary so protocol responses and diagnostics remain consistent.
    return sendProviderLinkFailure(req, reply, error);
  }
}
