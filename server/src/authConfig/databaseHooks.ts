import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { recordSessionAssurance, removeSessionAssurance } from "../accounts/state";
import { applicationSessionHandle } from "../accounts/sessionHandle";
import { confirmTrackedMemberSignIn } from "../accounts/memberSignInTracking";

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
}: {
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
}): Pick<BetterAuthOptions, "databaseHooks"> {
  return {
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const cleanedName = cleanText(typeof user.name === "string" ? user.name : "");
            const sanitizedUser = { ...user, name: cleanedName || "User" };
            // Internal credential creation is reachable only through CapacityLens's own
            // invite/bootstrap services and deliberately has no web request context.
            if (!context?.path) return { data: sanitizedUser };
            const emailSignup = context.path === "/sign-up/email";
            const externalSignup = externalIdentityPath(context.path);
            if (!emailSignup && !externalSignup) return { data: sanitizedUser };

            // Open EMAIL registration never opens external identity creation as a side effect.
            // Social/OIDC remains verified-email + invitation/allow-list gated in every posture.
            const externalProviderId = externalSignup ? providerIdFromExternalContext(context) : null;
            if (externalSignup && mode === "sso" && externalProviderId !== genericProviderId) {
              // Named social providers remain compatibility sign-in doors for principals that
              // already exist. Letting one create a new principal after cutover would immediately
              // introduce a strict-provider readiness blocker on the next restart.
              throw APIError.from("FORBIDDEN", {
                message: "New SSO-only identities must sign in through the required OIDC provider.",
                code: "STRICT_PROVIDER_REQUIRED",
              });
            }
            if (externalSignup && !(await externalIdentityAdmission?.(sanitizedUser))) {
              throw APIError.from("FORBIDDEN", {
                message: `This identity is not invited to this ${application.displayName} instance.`,
                code: "EXTERNAL_IDENTITY_NOT_INVITED",
              });
            }
            // Open signup applies only to email credentials. External identities remain subject to
            // the first-principal bootstrap claim and later invitation admission in every posture.
            if (allowOpenSignup && emailSignup) return { data: sanitizedUser };

            // The route-level check may have observed zero users concurrently with another
            // request. Re-check at the actual user insertion boundary and fail closed once the
            // winner exists; otherwise a delayed loser could still create an orphan identity.
            if (emailSignup && countUsers(db) !== 0) {
              throw APIError.from("CONFLICT", {
                message: "The first owner account has already been created.",
                code: "BOOTSTRAP_ALREADY_CLAIMED",
              });
            }
            // Only the first identity needs the cross-request bootstrap claim. Later external
            // identities are independently authorised by their live pre-authorised invite.
            if (countUsers(db) === 0) {
              if (!(context as { bootstrapClaimToken?: unknown }).bootstrapClaimToken) {
                throw APIError.from("CONFLICT", {
                  message: "First-owner setup did not hold its bootstrap claim.",
                  code: "BOOTSTRAP_ALREADY_IN_PROGRESS",
                });
              }
            }
            return { data: sanitizedUser };
          },
        },
      },
      session: {
        create: {
          after: async (session, context) => {
            const assurance = externalIdentityPath(context?.path)
              ? "federated"
              : context?.path?.startsWith("/two-factor/")
                ? "mfa"
                : "password";
            const providerId = assurance === "federated" ? providerIdFromExternalContext(context) : null;
            if (assurance === "federated" && (!providerId || !configuredFederatedIssuers.has(providerId))) {
              throw new Error("External session creation did not resolve a configured provider id.");
            }
            recordSessionAssurance(
              db,
              applicationSessionHandle(application.applicationId, String(session.token)),
              String(session.userId),
              assurance,
              providerId,
            );
            // Strict-SSO schemas deliberately omit Better Auth's password/MFA columns. Only the
            // password deployment needs to inspect enrolment before deciding whether this newly
            // created session still owes an MFA challenge.
            const enrolledMfa =
              mode === "password"
                ? (
                    twoFactorEnabledLookupStatement(db).get(String(session.userId)) as
                      { twoFactorEnabled?: unknown } | undefined
                  )?.twoFactorEnabled
                : false;
            const passwordSessionAwaitsMfa =
              assurance === "password" &&
              (requirePasswordMfa || enrolledMfa === true || enrolledMfa === 1 || enrolledMfa === "1");
            // Privacy-preserving account opt-in: record only the boolean fact that this identity
            // completed authentication. A password session that still owes an MFA challenge does
            // not count; the replacement MFA session confirms the sign-in after verification.
            if (!passwordSessionAwaitsMfa) confirmTrackedMemberSignIn(db, String(session.userId));
          },
        },
        delete: {
          after: async (session) => {
            removeSessionAssurance(db, applicationSessionHandle(application.applicationId, String(session.token)));
          },
        },
      },
    },
  };
}
