import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthFromEnvironment } from "../auth";
import { openDb } from "../db";
import { PASSWORD_ENV } from "../testHelpers";

const SSO_ENV = {
  ...PASSWORD_ENV,
  CAPACITYLENS_AUTH: "sso",
  CAPACITYLENS_SSO_CLIENT_ID: "client-id",
  CAPACITYLENS_SSO_CLIENT_SECRET: "client-secret",
  CAPACITYLENS_SSO_DISCOVERY_URL: "https://idp.test/.well-known/openid-configuration",
  CAPACITYLENS_SSO_ISSUER: "https://idp.test",
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
        CAPACITYLENS_AUTH: "password",
        CAPACITYLENS_SSO_PROVIDER_ID: "company-sso",
        CAPACITYLENS_SSO_BRAND: "google",
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
      }),
    ).toEqual([
      { id: "google", label: "Google", kind: "social", brand: "google", experimental: true },
      { id: "company-sso", label: "Single sign-on", kind: "oidc", brand: "google", experimental: false },
    ]);
  });

  it("warns when a branded provider points somewhere other than that brand's issuer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    configuredProviders({ ...SSO_ENV, CAPACITYLENS_SSO_BRAND: "google" });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("idp.test"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("accounts.google.com"));
  });

  it("stays quiet when the branded provider is that brand's own issuer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    configuredProviders({
      ...SSO_ENV,
      CAPACITYLENS_SSO_BRAND: "google",
      CAPACITYLENS_SSO_ISSUER: "https://accounts.google.com",
      CAPACITYLENS_SSO_DISCOVERY_URL: "https://accounts.google.com/.well-known/openid-configuration",
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
    expect(() => configuredProviders({ ...SSO_ENV, CAPACITYLENS_SSO_BRAND: "label-guess" })).toThrow(
      /OIDC_BRAND.*google.*microsoft.*generic/i,
    );
  });
});
