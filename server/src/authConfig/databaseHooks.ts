import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { recordSessionAssurance, removeSessionAssurance } from "../accounts/state";
import { buildApplicationSessionHandle } from "../accounts/buildApplicationSessionHandle";
import { confirmTrackedMemberSignIn } from "../accounts/memberSignInTracking";

interface HookOptions {
  db: Db;
  mode: "password" | "sso";
  application: BoundApplication;
  genericProviderId: string | null;
  configuredFederatedIssuers: Map<string, string>;
  allowOpenSignup: boolean;
  requirePasswordMfa: boolean;
  externalIdentityAdmission?: (candidate: { email?: string; emailVerified?: boolean }) => boolean | Promise<boolean>;
  providerIdFromExternalContext: (
    context: { path?: string; params?: Record<string, unknown> } | null | undefined,
  ) => string | null;
  countUsers: (db: Db) => number;
  twoFactorEnabledLookupStatement: (db: Db) => ReturnType<Db["prepare"]>;
  externalIdentityPath: (path: string | undefined) => boolean;
}
type DatabaseHooks = Exclude<BetterAuthOptions["databaseHooks"], undefined>;
type UserBefore = Exclude<Exclude<Exclude<DatabaseHooks["user"], undefined>["create"], undefined>["before"], undefined>;
type SessionAfter = Exclude<
  Exclude<Exclude<DatabaseHooks["session"], undefined>["create"], undefined>["after"],
  undefined
>;
type SessionDeleteAfter = Exclude<
  Exclude<Exclude<DatabaseHooks["session"], undefined>["delete"], undefined>["after"],
  undefined
>;
type Assurance = "federated" | "mfa" | "password";
type PresentHookContext = NonNullable<Parameters<UserBefore>[1]>;

const sanitizeUser = (user: Parameters<UserBefore>[0]) => {
  const cleanedName = cleanText(typeof user.name === "string" ? user.name : "");
  return { ...user, name: cleanedName || "User" };
};

async function admitExternalIdentity(
  options: HookOptions,
  user: Parameters<UserBefore>[0],
  context: PresentHookContext,
) {
  const providerId = options.providerIdFromExternalContext({
    path: context.path,
    ...(context.params === undefined ? {} : { params: context.params }),
  });
  if (options.mode === "sso" && providerId !== options.genericProviderId) {
    throw APIError.from("FORBIDDEN", {
      message: "New SSO-only identities must sign in through the required OIDC provider.",
      code: "STRICT_PROVIDER_REQUIRED",
    });
  }
  if (!(await options.externalIdentityAdmission?.(user))) {
    throw APIError.from("FORBIDDEN", {
      message: `This identity is not invited to this ${options.application.displayName} instance.`,
      code: "EXTERNAL_IDENTITY_NOT_INVITED",
    });
  }
}

function enforceBootstrapClaim(options: HookOptions, context: Parameters<UserBefore>[1], emailSignup: boolean) {
  // Re-check at insertion so a delayed request cannot create an orphan after another request wins.
  if (emailSignup && options.countUsers(options.db) !== 0) {
    throw APIError.from("CONFLICT", {
      message: "The first owner account has already been created.",
      code: "BOOTSTRAP_ALREADY_CLAIMED",
    });
  }
  // Only the first identity needs the cross-request claim. Later external identities are
  // independently authorised by their live pre-authorised invite.
  if (options.countUsers(options.db) === 0 && !(context as { bootstrapClaimToken?: unknown }).bootstrapClaimToken) {
    throw APIError.from("CONFLICT", {
      message: "First-owner setup did not hold its bootstrap claim.",
      code: "BOOTSTRAP_ALREADY_IN_PROGRESS",
    });
  }
}

function buildUserBefore(options: HookOptions): UserBefore {
  return async (user, context) => {
    const sanitizedUser = sanitizeUser(user);
    // Internal credential creation has no web request context and is reachable only through the
    // invite/bootstrap services.
    if (!context?.path) return { data: sanitizedUser };
    const emailSignup = context.path === "/sign-up/email";
    const externalSignup = options.externalIdentityPath(context.path);
    if (!emailSignup && !externalSignup) return { data: sanitizedUser };
    // Open email registration never opens external identity creation as a side effect. External
    // identities remain verified-email plus invitation/allow-list gated in every posture.
    if (externalSignup) await admitExternalIdentity(options, sanitizedUser, context);
    if (options.allowOpenSignup && emailSignup) return { data: sanitizedUser };
    enforceBootstrapClaim(options, context, emailSignup);
    return { data: sanitizedUser };
  };
}

function resolveAssurance(options: HookOptions, path: string | undefined): Assurance {
  if (options.externalIdentityPath(path)) return "federated";
  if (path?.startsWith("/two-factor/")) return "mfa";
  return "password";
}

function resolveProviderId(options: HookOptions, assurance: Assurance, context: Parameters<SessionAfter>[1]) {
  if (assurance !== "federated") return null;
  const path = context?.path;
  if (!path) throw new Error("External session creation did not resolve a configured provider id.");
  const providerId = options.providerIdFromExternalContext({
    path,
    ...(context.params === undefined ? {} : { params: context.params }),
  });
  if (!providerId || !options.configuredFederatedIssuers.has(providerId)) {
    throw new Error("External session creation did not resolve a configured provider id.");
  }
  return providerId;
}

function readEnrolledMfa(options: HookOptions, principalId: string): unknown {
  // Strict-SSO schemas omit Better Auth's password/MFA columns, so never query them in SSO mode.
  if (options.mode !== "password") return false;
  return (
    options.twoFactorEnabledLookupStatement(options.db).get(principalId) as { twoFactorEnabled?: unknown } | undefined
  )?.twoFactorEnabled;
}

function buildSessionAfter(options: HookOptions): SessionAfter {
  return async (session, context) => {
    const assurance = resolveAssurance(options, context?.path);
    const providerId = resolveProviderId(options, assurance, context);
    const principalId = String(session.userId);
    recordSessionAssurance({
      db: options.db,
      sessionId: buildApplicationSessionHandle(options.application.applicationId, String(session.token)),
      principalId,
      assurance,
      providerId,
    });
    const enrolledMfa = readEnrolledMfa(options, principalId);
    const awaitsMfa =
      assurance === "password" &&
      (options.requirePasswordMfa || enrolledMfa === true || enrolledMfa === 1 || enrolledMfa === "1");
    if (!awaitsMfa) confirmTrackedMemberSignIn(options.db, principalId);
  };
}

function buildSessionDeleteAfter(options: HookOptions): SessionDeleteAfter {
  return async (session) => {
    removeSessionAssurance(
      options.db,
      buildApplicationSessionHandle(options.application.applicationId, String(session.token)),
    );
  };
}

export function buildDatabaseHooks({
  db,
  mode,
  application,
  genericProviderId,
  configuredFederatedIssuers,
  allowOpenSignup,
  requirePasswordMfa,
  externalIdentityAdmission,
  providerIdFromExternalContext,
  countUsers,
  twoFactorEnabledLookupStatement,
  externalIdentityPath,
}: HookOptions): Pick<BetterAuthOptions, "databaseHooks"> {
  const options: HookOptions = {
    db,
    mode,
    application,
    genericProviderId,
    configuredFederatedIssuers,
    allowOpenSignup,
    requirePasswordMfa,
    ...(externalIdentityAdmission === undefined ? {} : { externalIdentityAdmission }),
    providerIdFromExternalContext,
    countUsers,
    twoFactorEnabledLookupStatement,
    externalIdentityPath,
  };
  return {
    databaseHooks: {
      user: {
        create: {
          before: buildUserBefore(options),
        },
      },
      session: {
        create: {
          after: buildSessionAfter(options),
        },
        delete: {
          after: buildSessionDeleteAfter(options),
        },
      },
    },
  };
}
