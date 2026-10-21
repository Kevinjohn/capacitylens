import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment, mintPasswordResetToken, runAuthMigrations } from "../auth";
import type { Auth } from "../auth";
import { openDb } from "../db";
import { PASSWORD_ENV } from "../testHelpers/passwordAuth";
import { registerServerFixtureCleanup } from "../testHelpers/registerServerFixtureCleanup";
import { captureResetToken, resetTokenCapture } from "./captureContexts";

const fixtures = registerServerFixtureCleanup();

function assertConfiguredAuth(auth: Auth | null): Auth {
  if (auth === null) throw new Error("Expected authentication to be configured");
  return auth;
}

describe("reset-token capture across the auth facade", () => {
  it("keeps overlapping capture chains separate and drops uncaptured tokens", async () => {
    const dependencies = {
      db: fixtures.trackDb(openDb(":memory:")),
      mail: null,
      publicUrl: new URL("http://localhost:8787"),
    };
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const auth = {
      api: {
        async requestPasswordReset({ body: { email } }: { body: { email: string } }) {
          if (email === "bruce@example.com") await firstCanFinish;
          await captureResetToken({ user: { id: email, email }, token: `token-for-${email}` }, dependencies);
          if (email === "clark@example.com") releaseFirst();
        },
      },
    } as Auth;

    await expect(
      Promise.all([
        mintPasswordResetToken(auth, "bruce@example.com"),
        mintPasswordResetToken(auth, "clark@example.com"),
      ]),
    ).resolves.toEqual(["token-for-bruce@example.com", "token-for-clark@example.com"]);
    await captureResetToken(
      { user: { id: "bruce", email: "bruce@example.com" }, token: "uncaptured-token" },
      dependencies,
    );
    expect(resetTokenCapture.getStore()).toBeUndefined();
  });

  it("captures the real configured Better Auth reset hook through the facade", async () => {
    const db = fixtures.trackDb(openDb(":memory:"));
    const { auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    const configuredAuth = assertConfiguredAuth(auth);
    await runAuthMigrations(configuredAuth);
    await configuredAuth.createCredentialUser({
      email: "bruce@example.com",
      name: "Bruce Wayne",
      password: "password-123456",
    });

    expect(await mintPasswordResetToken(configuredAuth, "bruce@example.com")).toEqual(expect.any(String));
    expect(await mintPasswordResetToken(configuredAuth, "missing@example.com")).toBeNull();
    expect(resetTokenCapture.getStore()).toBeUndefined();
  });
});
