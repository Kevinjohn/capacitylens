import type { AuthorizeRouteInput } from "../routes/routeShared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Auth, AccountMode } from "../auth";
import type { SsoCutoverIdentityPort } from "./identityPort/contracts";
import type { SsoCutoverAccountAdminPort } from "./adminPort/contracts";
import { registerProviderLinkRoutes } from "./providerLinkRoutes";
import { registerIdentityRepairRoutes } from "./identityRepairRoutes";

interface FederatedIdentityRouteDependencies {
  auth: Auth;
  authMode: Exclude<AccountMode, "off">;
  identity: SsoCutoverIdentityPort;
  administration: SsoCutoverAccountAdminPort;
  applicationId: string;
  authorize(input: Omit<AuthorizeRouteInput, "action"> & { action: "manageMembers" }): boolean;
  fail(reply: FastifyReply, error: unknown): unknown;
  toWebHeaders(headers: FastifyRequest["headers"]): Headers;
  trustProxyHeaders?: boolean;
}

/** Register authenticated provider linking and identity repair routes. */
export function registerFederatedIdentityRoutes(
  app: FastifyInstance,
  dependencies: FederatedIdentityRouteDependencies,
): void {
  registerProviderLinkRoutes(app, {
    auth: dependencies.auth,
    identity: { inspectProviderLinks: dependencies.identity.inspectProviderLinks },
    fail: dependencies.fail,
    toWebHeaders: dependencies.toWebHeaders,
    ...(dependencies.trustProxyHeaders === undefined ? {} : { trustProxyHeaders: dependencies.trustProxyHeaders }),
  });
  registerIdentityRepairRoutes(app, {
    auth: dependencies.auth,
    authMode: dependencies.authMode,
    identity: {
      correctPrincipalEmail: dependencies.identity.correctPrincipalEmail,
      removeFederatedLink: dependencies.identity.removeFederatedLink,
    },
    administration: {
      evaluateIdentityAdminAuthority: dependencies.administration.evaluateIdentityAdminAuthority,
      assertIdentityRepairAuthorityInTx: dependencies.administration.assertIdentityRepairAuthorityInTx,
    },
    applicationId: dependencies.applicationId,
    authorize: dependencies.authorize,
    fail: dependencies.fail,
  });
}
