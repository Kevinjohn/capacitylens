import { describe, expect, it } from "vitest";
import { resolveAccountEnvironment } from "./accountConfig";

const GOOGLE = {
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
};
const MICROSOFT = {
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "microsoft-client",
  SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
};
const HOSTED = {
  SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "hosted-sso-only",
  SMALLSASS_ACCOUNT_MODE: "sso",
  ...GOOGLE,
};

const retiredGenericKeys = [
  "SMALLSASS_ACCOUNT_OIDC_CLIENT_ID",
  "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET",
  "SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL",
  "SMALLSASS_ACCOUNT_OIDC_ISSUER",
  "SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL",
  "SMALLSASS_ACCOUNT_OIDC_TOKEN_URL",
  "SMALLSASS_ACCOUNT_OIDC_SCOPES",
  "SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID",
  "SMALLSASS_ACCOUNT_OIDC_LABEL",
  "SMALLSASS_ACCOUNT_OIDC_BRAND",
  "SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS",
] as const;

it.each(retiredGenericKeys)("rejects retired %s even when empty and another provider is valid", (key) => {
  for (const value of ["", "configured"]) {
    expect(() => resolveAccountEnvironment({ ...HOSTED, [key]: value })).toThrow(`${key} was removed`);
  }
});

it("rejects retired hosted profile before choosing a fallback", () => {
  expect(() =>
    resolveAccountEnvironment({ ...GOOGLE, SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "hosted-oidc-only" }),
  ).toThrow("hosted-oidc-only deployment profile was removed");
});

it.each(["CAPACITYLENS_SSO_CLIENT_ID", "CAPACITYLENS_SSO_ISSUER", "CAPACITYLENS_SSO_BOOTSTRAP_EMAILS"])(
  "rejects %s without recommending a removed key",
  (key) => {
    for (const value of ["", "configured"]) {
      expect(() => resolveAccountEnvironment({ [key]: value })).toThrow(
        /configure Google or tenant-specific Microsoft/,
      );
    }
  },
);

// Written out independently of the production map so that dropping a name there fails here.
const retiredAccountNames = [
  ["CAPACITYLENS_AUTH", "SMALLSASS_ACCOUNT_MODE"],
  ["BETTER_AUTH_SECRET", "SMALLSASS_ACCOUNT_SECRET"],
  ["BETTER_AUTH_URL", "SMALLSASS_ACCOUNT_PUBLIC_URL"],
  ["CAPACITYLENS_SETUP_TOKEN", "SMALLSASS_ACCOUNT_SETUP_TOKEN"],
  ["CAPACITYLENS_ALLOW_OPEN_SIGNUP", "SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP"],
  ["CAPACITYLENS_REQUIRE_MFA", "SMALLSASS_ACCOUNT_REQUIRE_MFA"],
  ["CAPACITYLENS_PASSWORD_BREACH_CHECK", "SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK"],
  ["CAPACITYLENS_SSO_MFA_ENFORCED", "SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED"],
  ["CAPACITYLENS_GOOGLE_CLIENT_ID", "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID"],
  ["CAPACITYLENS_GOOGLE_CLIENT_SECRET", "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET"],
  ["CAPACITYLENS_MICROSOFT_CLIENT_ID", "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID"],
  ["CAPACITYLENS_MICROSOFT_CLIENT_SECRET", "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET"],
  ["CAPACITYLENS_MICROSOFT_TENANT_ID", "SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID"],
  ["CAPACITYLENS_GITHUB_CLIENT_ID", "SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID"],
  ["CAPACITYLENS_GITHUB_CLIENT_SECRET", "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET"],
] as const;

describe("retired account environment names", () => {
  it.each(retiredAccountNames)("refuses %s and names %s", (retired, canonical) => {
    expect(() => resolveAccountEnvironment({ [retired]: "configured" })).toThrow(
      `${retired} was removed; use ${canonical}.`,
    );
  });

  it.each(retiredAccountNames)("refuses a whitespace-only %s", (retired, canonical) => {
    expect(() => resolveAccountEnvironment({ [retired]: "  " })).toThrow(`${retired} was removed; use ${canonical}.`);
  });

  it.each(retiredAccountNames)("accepts and drops an empty %s placeholder", (retired) => {
    const resolved = resolveAccountEnvironment({ [retired]: "" });
    expect(resolved.env).not.toHaveProperty(retired);
  });
});

describe("hosted provider-only profile", () => {
  it("accepts Google, tenant-specific Microsoft, or both", () => {
    for (const providers of [GOOGLE, MICROSOFT, { ...GOOGLE, ...MICROSOFT }]) {
      expect(
        resolveAccountEnvironment({
          SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "hosted-sso-only",
          SMALLSASS_ACCOUNT_MODE: "sso",
          ...providers,
        }).profile,
      ).toBe("hosted-sso-only");
    }
  });

  it.each([
    [{ SMALLSASS_ACCOUNT_MODE: "password" }, /hosted password accounts are prohibited/i],
    [{ SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1" }, /forbids open signup/i],
    [{ SMALLSASS_ACCOUNT_SETUP_TOKEN: "setup" }, /password-account configuration/i],
    [{ SMALLSASS_ACCOUNT_REQUIRE_MFA: "1" }, /password-account configuration/i],
    [{ CAPACITYLENS_CREATE_ADMIN_ADMIN: "1" }, /password-account configuration/i],
    [{ SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "partial" }, /forbids GitHub/i],
    [{ SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "partial" }, /forbids GitHub/i],
  ] as const)("rejects incompatible hosted configuration %#", (override, error) => {
    expect(() => resolveAccountEnvironment({ ...HOSTED, ...override })).toThrow(error);
  });

  it("rejects a missing company provider", () => {
    expect(() =>
      resolveAccountEnvironment({
        ...HOSTED,
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: undefined,
        SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: undefined,
      }),
    ).toThrow(/Google or tenant-specific Microsoft/);
  });
});

it("normalizes supported settings and preserves secrets", () => {
  const secret = `  ${"x".repeat(32)}  `;
  const result = resolveAccountEnvironment({
    SMALLSASS_ACCOUNT_MODE: " password ",
    SMALLSASS_ACCOUNT_SECRET: secret,
    SMALLSASS_ACCOUNT_PUBLIC_URL: " https://capacity.example.test ",
  });
  expect(result.env.SMALLSASS_ACCOUNT_MODE).toBe("password");
  expect(result.env.SMALLSASS_ACCOUNT_SECRET).toBe(secret);
  expect(result.env.SMALLSASS_ACCOUNT_PUBLIC_URL).toBe("https://capacity.example.test");
  expect(resolveAccountEnvironment(result.env).env).toBe(result.env);
});

it("rejects whitespace-only mode", () => {
  expect(() => resolveAccountEnvironment({ SMALLSASS_ACCOUNT_MODE: "   " })).toThrow(/contains only whitespace/);
});

it("requires a company provider in self-hosted mixed and SSO-only profiles", () => {
  for (const [profile, mode] of [
    ["self-hosted-mixed", "password"],
    ["self-hosted-sso-only", "sso"],
  ]) {
    expect(() =>
      resolveAccountEnvironment({ SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: profile, SMALLSASS_ACCOUNT_MODE: mode }),
    ).toThrow(/Google or tenant-specific Microsoft/);
    expect(() =>
      resolveAccountEnvironment({
        SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: profile,
        SMALLSASS_ACCOUNT_MODE: mode,
        ...GOOGLE,
      }),
    ).not.toThrow();
  }
});

it("rejects external providers in self-hosted password-only profile", () => {
  expect(() =>
    resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-password",
      SMALLSASS_ACCOUNT_MODE: "password",
      ...GOOGLE,
    }),
  ).toThrow(/does not permit external identity providers/);
});
