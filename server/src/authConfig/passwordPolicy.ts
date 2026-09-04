import type { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_INPUT_CODE_UNITS,
  passwordLengthFailure,
} from "@capacitylens/shared/domain/password";
import {
  PasswordPolicyDependencyError,
  PasswordPolicyError,
  assertNoContextSpecificPassword,
  assertPasswordNotBreached,
  scryptPasswordHasher,
  type PasswordHasher,
} from "../passwordSecurity";

type SessionDeletionLifecycleRef = {
  current: {
    prepareUser(userId: string, reason: "session_revoked"): readonly string[];
  } | null;
};

export function buildPasswordPolicy({
  env,
  mode,
  runtimeEnvironment,
  passwordContextWords,
  passwordResetSessionCapture,
  sessionDeletionLifecycleRef,
  captureResetToken,
  hashPasswordWithBackpressure,
  verifyPasswordWithBackpressure,
  resetLinkTtlSeconds,
}: {
  env: Record<string, string | undefined>;
  mode: "password" | "sso";
  runtimeEnvironment: string | undefined;
  passwordContextWords: readonly string[];
  passwordResetSessionCapture: AsyncLocalStorage<{ sessionHandles: readonly string[] }>;
  sessionDeletionLifecycleRef: SessionDeletionLifecycleRef;
  captureResetToken: (input: { token: string }) => Promise<void>;
  hashPasswordWithBackpressure: (hasher: PasswordHasher, password: string) => Promise<string>;
  verifyPasswordWithBackpressure: (
    hasher: PasswordHasher,
    input: Parameters<PasswordHasher["verify"]>[0],
  ) => Promise<boolean>;
  resetLinkTtlSeconds: number;
}): Pick<BetterAuthOptions, "emailAndPassword"> & {
  assertAuthRequestPasswordLength: (path: string, body: unknown) => void;
} {
  // The password floor remains unconditional, including when the optional bootstrap-owner flag
  // is active. createBootstrapAdmin generates a high-entropy password that comfortably exceeds it.

  const testRuntime = runtimeEnvironment === "test";
  if (testRuntime && !process.env.VITEST) {
    console.warn(
      "capacitylens-server: TEST credential profile active — scrypt cost is reduced and breached-password screening is disabled; never retain these credentials or expose this process.",
    );
  }
  const breachCheckEnabled = env.CAPACITYLENS_PASSWORD_BREACH_CHECK !== "off" && !testRuntime;
  const baseHasher = scryptPasswordHasher(testRuntime ? 2 ** 10 : undefined);
  const assertCredentialPasswordLength = (password: unknown): void => {
    if (typeof password !== "string") return;
    const failure = passwordLengthFailure(password);
    if (!failure) return;
    throw APIError.from(
      "BAD_REQUEST",
      failure === "too-short"
        ? {
            message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            code: "PASSWORD_TOO_SHORT",
          }
        : {
            message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
            code: "PASSWORD_TOO_LONG",
          },
    );
  };
  const assertAuthRequestPasswordLength = (path: string, body: unknown): void => {
    if (typeof body !== "object" || body === null) return;
    const candidate = body as { password?: unknown; newPassword?: unknown };
    if (path === "/sign-up/email") assertCredentialPasswordLength(candidate.password);
    if (path === "/reset-password" || path === "/change-password") {
      assertCredentialPasswordLength(candidate.newPassword);
    }
  };
  const passwordHash = async (password: string): Promise<string> => {
    // Direct identity-port creation bypasses Better Auth's HTTP route guards. Keep the shared
    // Unicode code-point policy at the last common boundary before every new hash is produced.
    assertCredentialPasswordLength(password);
    try {
      assertNoContextSpecificPassword(password, passwordContextWords);
      if (breachCheckEnabled) await assertPasswordNotBreached(password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw APIError.from("BAD_REQUEST", {
          message: error.message,
          code: error.code,
        });
      }
      if (error instanceof PasswordPolicyDependencyError) {
        throw APIError.from("SERVICE_UNAVAILABLE", {
          message: error.message,
          code: error.code,
        });
      }
      throw error;
    }
    return hashPasswordWithBackpressure(baseHasher, password);
  };

  return {
    emailAndPassword: {
      enabled: mode === "password",
      // The static library flag stays OFF so the sign-up gate has ONE owner: the live hooks.before
      // below (see the SECURE DEFAULT comment above). Better Auth 1.6.23 enforces disableSignUp
      // even for server-side auth.api.signUpEmail calls (sign-up.mjs:143), so leaving it on would
      // also break the BROWSER first-run bootstrap (the login screen's "Create the owner account"
      // form, which really does POST /api/auth/sign-up/email) — the headless
      // --create-owner-admin-admin path is unaffected either way, since it now bypasses this route
      // entirely (see createBootstrapAdmin).
      disableSignUp: false,
      // PIN the minimum length to the shared constant rather than inheriting Better Auth's default,
      // so the server bound and the client reset-page pre-check (both read MIN_PASSWORD_LENGTH) can't
      // drift — and a library-default change can't silently move the server's floor. UNCONDITIONAL:
      // no boot, flagged or not, ever lowers this — see the bootstrap comment above for how the
      // required operator-supplied bootstrap password must satisfy the same policy.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Better Auth counts UTF-16 code units. Give its transport guard enough room for 128 astral
      // code points; the hook and hash boundary enforce CapacityLens's shared code-point ceiling.
      maxPasswordLength: MAX_PASSWORD_INPUT_CODE_UNITS,
      password: {
        hash: passwordHash,
        verify: (input) => verifyPasswordWithBackpressure(baseHasher, input),
      },
      // Admin-issued reset links (P1.18) — password mode ONLY: 'sso' delegates credentials to the
      // IdP, and configuring sendResetPassword would needlessly enable Better Auth's public
      // request-password-reset endpoint there. See captureResetToken/mintPasswordResetToken above.
      ...(mode === "password"
        ? {
            sendResetPassword: captureResetToken,
            // Better Auth owns the reset's session deletion. Prepare the application registry and
            // durable end audit immediately before that deletion; the handler wrapper commits the
            // in-memory removal only after the library returns a successful response.
            onPasswordReset: async ({ user }: { user: { id: string } }) => {
              const capture = passwordResetSessionCapture.getStore();
              if (capture) {
                capture.sessionHandles =
                  sessionDeletionLifecycleRef.current?.prepareUser(user.id, "session_revoked") ?? [];
              }
            },
            resetPasswordTokenExpiresIn: resetLinkTtlSeconds,
            // A reset is "I lost control of my credential" (or an admin offboarding a laptop):
            // every existing session for that user dies with the old password.
            revokeSessionsOnPasswordReset: true,
          }
        : {}),
    },
    assertAuthRequestPasswordLength,
  };
}
