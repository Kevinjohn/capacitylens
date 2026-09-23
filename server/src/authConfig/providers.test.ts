import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthFromEnvironment } from "../auth";
import { openDb } from "../db";
import { PASSWORD_ENV } from "../testHelpers";
import { readVerifiedMicrosoftProfile } from "./socialProviders";

const SSO_ENV = {
  ...PASSWORD_ENV,
  SMALLSASS_ACCOUNT_MODE: "sso",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://idp.test/.well-known/openid-configuration",
  SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://idp.test",
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes explicit brands without changing provider mechanisms", () => {
    expect(
      configuredProviders({
        ...SSO_ENV,
        SMALLSASS_ACCOUNT_MODE: "password",
        SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID: "company-sso",
        SMALLSASS_ACCOUNT_OIDC_BRAND: "google",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
      }),
    ).toEqual([
      { id: "google", label: "Google", kind: "social", brand: "google", experimental: false },
      { id: "company-sso", label: "Single sign-on", kind: "oidc", brand: "google", experimental: false },
    ]);
  });

  it("warns when a branded provider points somewhere other than that brand's issuer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    configuredProviders({ ...SSO_ENV, SMALLSASS_ACCOUNT_OIDC_BRAND: "google" });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("idp.test"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("accounts.google.com"));
  });

  it("stays quiet when the branded provider is that brand's own issuer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    configuredProviders({
      ...SSO_ENV,
      SMALLSASS_ACCOUNT_OIDC_BRAND: "google",
      SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://accounts.google.com",
      SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://accounts.google.com/.well-known/openid-configuration",
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet for a generic provider whatever its issuer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    configuredProviders(SSO_ENV);

    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults strict OIDC to generic and rejects unknown brands", () => {
    expect(configuredProviders(SSO_ENV)[0]).toMatchObject({ kind: "oidc", brand: "generic" });
    expect(() => configuredProviders({ ...SSO_ENV, SMALLSASS_ACCOUNT_OIDC_BRAND: "label-guess" })).toThrow(
      /OIDC_BRAND.*google.*microsoft.*generic/i,
    );
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
