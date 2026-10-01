import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { openDb } from "./db";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { call, PASSWORD_ENV } from "./testHelpers";

describe("SMALLSASS_ACCOUNT_MODE password", () => {
  // Better Auth locks a verification token before opening its consume transaction; the gate must not
  // let two requests for the same token wait on each other and stall every other request.
  it("answers concurrent reset attempts for one token without stalling other requests", async () => {
    const db = openDb(":memory:");
    const { mode, auth } = createAuthFromEnvironment(db, PASSWORD_ENV);
    if (auth === null) throw new Error("Expected authentication to be configured.");
    await runAuthMigrations(auth);
    const app = createApp(db, { authMode: mode, auth });
    const reset = () =>
      call(app, {
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token: "invented-token", newPassword: "replacement-password-123" },
      });
    const outcome = Promise.all([reset(), reset(), call(app, { method: "GET", url: "/api/health" })]);
    const stalled = new Promise<"stalled">((resolve) => setTimeout(() => resolve("stalled"), 2_000).unref());

    const settled = await Promise.race([outcome, stalled]);
    expect(settled).not.toBe("stalled");
    const [first, second, health] = settled as Awaited<typeof outcome>;
    expect([first.statusCode, second.statusCode]).toEqual([400, 400]);
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});
