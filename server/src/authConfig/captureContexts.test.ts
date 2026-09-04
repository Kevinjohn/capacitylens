import { describe, expect, it } from "vitest";
import { authFromEnv, mintPasswordResetToken, runAuthMigrations, type Auth } from "../auth";
import { openDb } from "../db";
import { PASSWORD_ENV, registerServerFixtureCleanup } from "../testHelpers";
import { captureResetToken, resetTokenCapture } from "./captureContexts";

const fixtures = registerServerFixtureCleanup();

describe("reset-token capture across the auth facade", () => {
  it("keeps overlapping capture chains separate and drops uncaptured tokens", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const auth = {
      api: {
        async requestPasswordReset({ body: { email } }: { body: { email: string } }) {
          if (email === "bruce@example.com") await firstCanFinish;
          await captureResetToken({ token: `token-for-${email}` });
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
    await captureResetToken({ token: "uncaptured-token" });
    expect(resetTokenCapture.getStore()).toBeUndefined();
  });

  it("captures the real configured Better Auth reset hook through the facade", async () => {
    const db = fixtures.trackDb(openDb(":memory:"));
    const { auth } = authFromEnv(db, PASSWORD_ENV);
    await runAuthMigrations(auth!);
    await auth!.createCredentialUser("bruce@example.com", "Bruce Wayne", "unique-passphrase-2026");

    expect(await mintPasswordResetToken(auth!, "bruce@example.com")).toEqual(expect.any(String));
    expect(await mintPasswordResetToken(auth!, "missing@example.com")).toBeNull();
    expect(resetTokenCapture.getStore()).toBeUndefined();
  });
});
