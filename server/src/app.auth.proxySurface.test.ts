import { describe, expect, it } from "vitest";
import { appWithAuth } from "./fixtures/appWithAuth";
import { call, cookiesOf, PASSWORD_ENV } from "./testHelpers/passwordAuth";

const removedSecondFactorOperations = [
  "/api/auth/two-factor/enable",
  "/api/auth/two-factor/disable",
  "/api/auth/two-factor/generate-backup-codes",
  "/api/auth/two-factor/verify-totp",
  "/api/auth/two-factor/verify-backup-code",
];

describe("Better Auth proxy surface", () => {
  it("keeps unclassified account mutations and retired operations closed", async () => {
    const { app } = await appWithAuth({ env: PASSWORD_ENV });
    for (const url of [
      "/api/auth/oauth2/link",
      "/api/auth/link-social",
      "/api/auth/unlink-account",
      "/api/auth/update-user",
      "/api/auth/change-email",
      "/api/auth/delete-user",
      "/api/auth/revoke-sessions",
      "/api/auth/future-account-mutation",
      ...removedSecondFactorOperations,
    ]) {
      expect((await call(app, { method: "POST", url, payload: {} })).statusCode, url).toBe(404);
    }
    expect((await call(app, { method: "GET", url: "/api/auth/future-read-route" })).statusCode).toBe(404);
    expect((await call(app, { method: "GET", url: "/api/auth/get-session" })).statusCode).not.toBe(404);
  });

  it.each([
    ["password", PASSWORD_ENV],
    [
      "mixed",
      {
        ...PASSWORD_ENV,
        CAPACITYLENS_MODE: "password-and-sso",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
      },
    ],
  ])("keeps retired operations closed to authenticated users in %s mode", async (_mode, env) => {
    const { app } = await appWithAuth({ env });
    const signUp = await call(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "owner@example.com", password: "password-123456", name: "Bruce Wayne" },
    });
    expect(signUp.statusCode).toBe(200);
    const cookie = cookiesOf(signUp);
    for (const url of removedSecondFactorOperations) {
      expect((await call(app, { method: "POST", url, headers: { cookie }, payload: {} })).statusCode, url).toBe(404);
    }
  });
});
