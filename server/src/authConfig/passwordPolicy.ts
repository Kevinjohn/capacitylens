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
  createScryptPasswordHasher,
  type PasswordHasher,
} from "../passwordSecurity";

type SessionDeletionLifecycleRef = {
  current: {
    prepareUser(userId: string, reason: "session_revoked"): readonly string[];
  } | null;
};

interface BuildPasswordPolicyInput {
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
}

function createPasswordLengthAssertions(): {
  assertCredentialPasswordLength: (password: unknown) => void;
  assertAuthRequestPasswordLength: (path: string, body: unknown) => void;
} {
  const assertCredentialPasswordLength = (password: unknown): void => {
    if (typeof password !== "string") return;
    const failure = passwordLengthFailure(password);
    if (!failure) return;
    throw APIError.from(
      "BAD_REQUEST",
      failure === "too-short"
        ? { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, code: "PASSWORD_TOO_SHORT" }
        : { message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`, code: "PASSWORD_TOO_LONG" },
    );
  };
  return {
    assertCredentialPasswordLength,
    assertAuthRequestPasswordLength(path, body) {
      if (typeof body !== "object" || body === null) return;
      const candidate = body as { password?: unknown; newPassword?: unknown };
      if (path === "/sign-up/email") assertCredentialPasswordLength(candidate.password);
      if (path === "/reset-password" || path === "/change-password") {
        assertCredentialPasswordLength(candidate.newPassword);
      }
    },
  };
}

function createPasswordHash({
  input,
  baseHasher,
  breachCheckEnabled,
  assertCredentialPasswordLength,
}: {
  input: BuildPasswordPolicyInput;
  baseHasher: PasswordHasher;
  breachCheckEnabled: boolean;
  assertCredentialPasswordLength: (password: unknown) => void;
}): (password: string) => Promise<string> {
  return async (password) => {
    assertCredentialPasswordLength(password);
    try {
      assertNoContextSpecificPassword(password, input.passwordContextWords);
      if (breachCheckEnabled) await assertPasswordNotBreached(password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw APIError.from("BAD_REQUEST", { message: error.message, code: error.code });
      }
      if (error instanceof PasswordPolicyDependencyError) {
        throw APIError.from("SERVICE_UNAVAILABLE", { message: error.message, code: error.code });
      }
      throw error;
    }
    return input.hashPasswordWithBackpressure(baseHasher, password);
  };
}

function passwordResetOptions(input: BuildPasswordPolicyInput): Partial<BetterAuthOptions["emailAndPassword"]> {
  if (input.mode !== "password") return {};
  return {
    sendResetPassword: input.captureResetToken,
    onPasswordReset: async ({ user }: { user: { id: string } }) => {
      const capture = input.passwordResetSessionCapture.getStore();
      if (capture) {
        capture.sessionHandles =
          input.sessionDeletionLifecycleRef.current?.prepareUser(user.id, "session_revoked") ?? [];
      }
    },
    resetPasswordTokenExpiresIn: input.resetLinkTtlSeconds,
    revokeSessionsOnPasswordReset: true,
  };
}

export function buildPasswordPolicy(input: BuildPasswordPolicyInput): Pick<BetterAuthOptions, "emailAndPassword"> & {
  assertAuthRequestPasswordLength: (path: string, body: unknown) => void;
} {
  const { env, mode, runtimeEnvironment, verifyPasswordWithBackpressure } = input;
  const testRuntime = runtimeEnvironment === "test";
  if (testRuntime && !process.env.VITEST) {
    console.warn(
      "capacitylens-server: TEST credential profile active — scrypt cost is reduced and breached-password screening is disabled; never retain these credentials or expose this process.",
    );
  }
  const breachCheckEnabled = env.CAPACITYLENS_PASSWORD_BREACH_CHECK !== "off" && !testRuntime;
  const baseHasher = createScryptPasswordHasher(testRuntime ? 2 ** 10 : undefined);
  const { assertCredentialPasswordLength, assertAuthRequestPasswordLength } = createPasswordLengthAssertions();
  const passwordHash = createPasswordHash({
    input,
    baseHasher,
    breachCheckEnabled,
    assertCredentialPasswordLength,
  });

  return {
    emailAndPassword: {
      enabled: mode === "password",
      // The live before hook owns sign-up gating; the browser's first-run bootstrap uses this route.
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
      ...passwordResetOptions(input),
    },
    assertAuthRequestPasswordLength,
  };
}
