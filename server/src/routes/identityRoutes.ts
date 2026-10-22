import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import type { ApplicationSession } from "@capacitylens/shared/account/types";
import { can } from "@capacitylens/shared/domain/access";
import type { AccountMode, Auth, SessionUser } from "../auth";
import { countUsers, DEMO_USER } from "../auth";
import type { MasqueradeRegistry } from "../MasqueradeRegistry";
import { countAccounts, isAccountCreateCapped } from "./accountEntityRoutes";
import type { ResolveIncomingSessionInput } from "./appSessionResolution";
import { REPLY_ERRORS } from "./replyErrors";

type SessionResolutionResult =
  | { kind: "absent_or_invalid" }
  | { kind: "verified"; session: ApplicationSession }
  | { kind: "backend_failure"; error: unknown };

/** Dependencies used only by the application identity projection at /api/auth/me. */
export interface IdentityRouteDependencies {
  accountAdminPort: Pick<AccountAdminPort, "listWorkspacesForPrincipal">;
  auth: Auth | null;
  authMode: AccountMode;
  db: Parameters<typeof countAccounts>[0];
  masquerades: MasqueradeRegistry;
  multiAccount: boolean;
  resolveIncomingSession: (input: ResolveIncomingSessionInput) => Promise<SessionResolutionResult>;
  sessionUserFromApplicationSession: (session: ApplicationSession) => SessionUser;
}

interface CanUserCreateAccountInput {
  administration: IdentityRouteDependencies["accountAdminPort"];
  authMode: AccountMode;
  userId: string;
  count: number;
}

async function canUserCreateAccount({
  administration,
  authMode,
  userId,
  count,
}: CanUserCreateAccountInput): Promise<boolean> {
  return (
    count === 0 ||
    authMode === "off" ||
    (await administration.listWorkspacesForPrincipal({ principalId: userId })).some((membership) =>
      can(membership.role, "manageMembers"),
    )
  );
}

type ReadAuthenticatedIdentityOptions = {
  dependencies: IdentityRouteDependencies;
  session: ApplicationSession;
  capAllows: boolean;
};

type CanAuthenticatedUserCreateAccountInput = ReadAuthenticatedIdentityOptions & { userId: string };

async function canAuthenticatedUserCreateAccount({
  dependencies,
  session,
  userId,
  capAllows,
}: CanAuthenticatedUserCreateAccountInput): Promise<boolean> {
  const { accountAdminPort, auth, authMode, db, masquerades } = dependencies;
  // The capability mirrors POST /api/orgs: masquerades and untrusted SSO sessions fail closed,
  // then both the account cap and workspace authority must allow creation.
  const trustedSsoSession =
    authMode !== "sso-only" ||
    (session.assurance === "federated" &&
      (auth?.permittedCompanyProviderIds?.has(session.providerId) ??
        session.providerId === auth?.defaultCompanyProvider?.id));
  if (masquerades.lookup(session.id) !== undefined || !capAllows || !trustedSsoSession) return false;
  return canUserCreateAccount({
    administration: accountAdminPort,
    authMode,
    userId,
    count: countAccounts(db),
  });
}

async function readAuthenticatedIdentity({ dependencies, session, capAllows }: ReadAuthenticatedIdentityOptions) {
  const { auth, authMode, multiAccount } = dependencies;
  const user = dependencies.sessionUserFromApplicationSession(session);
  const canCreateAccount = await canAuthenticatedUserCreateAccount({
    dependencies,
    session,
    userId: user.id,
    capAllows,
  });
  return {
    authMode,
    user,
    reauthMethod: session.assurance === "federated" ? "provider" : "password",
    reauthProviderId: session.providerId ?? null,
    providers: auth?.providers ?? [],
    multiAccount,
    canCreateAccount,
  };
}

const canEmailPasswordReset = (authMode: AccountMode, auth: Auth | null): boolean =>
  allowsPasswordSignIn(authMode) && auth?.mail != null;

async function sendIdentity(req: FastifyRequest, reply: FastifyReply, dependencies: IdentityRouteDependencies) {
  const { auth, authMode, db, multiAccount, resolveIncomingSession } = dependencies;
  const capAllows = !isAccountCreateCapped({ db, multiAccount });
  if (authMode === "off") {
    return reply
      .code(200)
      .send({ authMode, user: DEMO_USER, providers: [], multiAccount, canCreateAccount: capAllows });
  }
  const resolution = await resolveIncomingSession({ req, force: true });
  if (resolution.kind === "absent_or_invalid") {
    // Zero users is only a bootstrap-availability signal; no tenant facts enter the 401 response.
    const needsSetup =
      countUsers(db) === 0 &&
      (allowsPasswordSignIn(authMode) || auth?.providers.some((provider) => provider.id === "microsoft"));
    return reply.code(401).send({
      authMode,
      providers: auth?.providers ?? [],
      error: REPLY_ERRORS.signInRequired,
      passwordResetEmail: canEmailPasswordReset(authMode, auth),
      ...(needsSetup ? { needsSetup: true } : {}),
    });
  }
  if (resolution.kind === "backend_failure") {
    req.log.error(resolution.error);
    return reply.code(503).send({ authMode, error: REPLY_ERRORS.signInUnavailable });
  }
  try {
    return reply
      .code(200)
      .send(await readAuthenticatedIdentity({ dependencies, session: resolution.session, capAllows }));
  } catch (error) {
    // Backend failure is distinct from an absent session and must retain its 503 surface.
    req.log.error(error);
    return reply.code(503).send({ authMode, error: REPLY_ERRORS.signInUnavailable });
  }
}

/** Registers the application identity projection, including the auth-off demo identity. */
export function registerIdentityRoutes(app: FastifyInstance, dependencies: IdentityRouteDependencies): void {
  app.get("/api/auth/me", (req, reply) => sendIdentity(req, reply, dependencies));
}
