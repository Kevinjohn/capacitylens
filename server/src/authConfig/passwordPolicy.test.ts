import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { preparedPasswordHashCapture } from "./captureContexts";
import { buildPasswordPolicy } from "./passwordPolicy";

function policyWithHashSpy() {
  const hashPasswordWithBackpressure = vi.fn(async (_hasher: unknown, password: string) => `hash:${password}`);
  const policy = buildPasswordPolicy({
    env: {},
    mode: "password-only",
    runtimeEnvironment: "test",
    passwordContextWords: [],
    passwordResetSessionCapture: new AsyncLocalStorage(),
    sessionDeletionLifecycleRef: { current: null },
    captureResetToken: async () => undefined,
    hashPasswordWithBackpressure,
    verifyPasswordWithBackpressure: async () => true,
    resetLinkTtlSeconds: 60,
  });
  const hash = policy.emailAndPassword.password?.hash;
  if (!hash) throw new Error("Expected a configured password hash.");
  return { policy, hash, hashPasswordWithBackpressure };
}

describe("sign-up password preparation", () => {
  it("hashes before the sign-up endpoint so its transaction reuses the prepared hash", async () => {
    const { policy, hash, hashPasswordWithBackpressure } = policyWithHashSpy();
    await preparedPasswordHashCapture.run({ password: null, hash: null }, async () => {
      await policy.prepareSignUpPasswordHash("/sign-up/email", { password: "password-123456" });
      expect(hashPasswordWithBackpressure).toHaveBeenCalledTimes(1);

      await expect(hash("password-123456")).resolves.toBe("hash:password-123456");
      expect(hashPasswordWithBackpressure).toHaveBeenCalledTimes(1);
      await expect(hash("different-password-1")).resolves.toBe("hash:different-password-1");
      expect(hashPasswordWithBackpressure).toHaveBeenCalledTimes(2);
    });
  });

  it("prepares nothing outside a sign-up request", async () => {
    const { policy, hashPasswordWithBackpressure } = policyWithHashSpy();
    await policy.prepareSignUpPasswordHash("/sign-up/email", { password: "password-123456" });
    await preparedPasswordHashCapture.run({ password: null, hash: null }, () =>
      policy.prepareSignUpPasswordHash("/change-password", { password: "password-123456" }),
    );
    expect(hashPasswordWithBackpressure).not.toHaveBeenCalled();
  });
});
