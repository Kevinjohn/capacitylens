import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment } from "../auth";
import { openDb } from "../db";
import { PASSWORD_ENV } from "../testHelpers";
import { readVerifiedMicrosoftProfile } from "./socialProviders";

const SSO_ENV = {
  ...PASSWORD_ENV,
  SMALLSASS_ACCOUNT_MODE: "sso-only",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-id",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
};

function configuredProviders(environment: Record<string, string>) {
  const db = openDb(":memory:");
  try {
    const { auth } = createAuthFromEnvironment(db, environment);
    if (!auth) throw new Error("Expected authentication to be configured.");
    return [...auth.providers];
  } finally {
    db.close();
  }
}

describe("provider presentation metadata", () => {
  it("publishes named company providers and keeps GitHub experimental", () => {
    expect(
      configuredProviders({
        ...SSO_ENV,
        SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "microsoft-id",
        SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
        SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
        SMALLSASS_ACCOUNT_MAIL_HOST: "mail.example.test",
        SMALLSASS_ACCOUNT_MAIL_PORT: "587",
        SMALLSASS_ACCOUNT_MAIL_USER: "mailer",
        SMALLSASS_ACCOUNT_MAIL_PASSWORD: "test-mail-password",
        SMALLSASS_ACCOUNT_MAIL_FROM: "identity@example.test",
        SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "github-id",
        SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "github-secret",
      }),
    ).toEqual([
      { id: "google", label: "Google", kind: "social", brand: "google", experimental: false },
      { id: "microsoft", label: "Microsoft", kind: "social", brand: "microsoft", experimental: false },
      { id: "github", label: "GitHub", kind: "social", brand: "generic", experimental: true },
    ]);
  });
});

describe("Microsoft tenant claim boundary", () => {
  const tenant = "01234567-89ab-cdef-0123-456789abcdef";
  const clientId = "company-client";
  const claims = () => ({
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    tid: tenant,
    oid: "immutable-object-id",
    sub: "different-pairwise-subject",
    picture: "https://example.test/avatar.png",
  });

  it("correlates the account and avatar by oid rather than sub", () => {
    expect(readVerifiedMicrosoftProfile(claims(), tenant, clientId)).toEqual({
      subject: "immutable-object-id",
      picture: "https://example.test/avatar.png",
    });
  });

  it.each([
    ["issuer", { iss: "https://login.microsoftonline.com/other/v2.0" }],
    ["audience", { aud: "other-client" }],
    ["expiry", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["tenant", { tid: "9188040d-6c67-4c5b-b112-36a304b66dad" }],
    ["object id", { oid: "" }],
  ])("refuses a mismatched %s", (_label, changed) => {
    expect(() => readVerifiedMicrosoftProfile({ ...claims(), ...changed }, tenant, clientId)).toThrow();
  });

  it("requires a specific non-consumer tenant at startup", () => {
    expect(() =>
      configuredProviders({
        ...SSO_ENV,
        SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: clientId,
        SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/MICROSOFT_TENANT_ID/);
  });
});
