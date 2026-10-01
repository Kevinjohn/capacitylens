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
  SMALLSASS_ACCOUNT_MODE: "sso-only",
  ...GOOGLE,
};

describe("hosted provider-only profile", () => {
  it("accepts Google, tenant-specific Microsoft, or both", () => {
    for (const providers of [GOOGLE, MICROSOFT, { ...GOOGLE, ...MICROSOFT }]) {
      expect(
        resolveAccountEnvironment({
          SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "hosted-sso-only",
          SMALLSASS_ACCOUNT_MODE: "sso-only",
          ...providers,
        }).profile,
      ).toBe("hosted-sso-only");
    }
  });

  it.each([
    [{ SMALLSASS_ACCOUNT_MODE: "password-only" }, /hosted password accounts are prohibited/i],
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
    SMALLSASS_ACCOUNT_MODE: " password-only ",
    SMALLSASS_ACCOUNT_SECRET: secret,
    SMALLSASS_ACCOUNT_PUBLIC_URL: " https://capacity.example.test ",
  });
  expect(result.env.SMALLSASS_ACCOUNT_MODE).toBe("password-only");
  expect(result.env.SMALLSASS_ACCOUNT_SECRET).toBe(secret);
  expect(result.env.SMALLSASS_ACCOUNT_PUBLIC_URL).toBe("https://capacity.example.test");
  expect(resolveAccountEnvironment(result.env).env).toBe(result.env);
});

it("trims provider and mail settings and drops whitespace-only ones", () => {
  const result = resolveAccountEnvironment({
    SMALLSASS_ACCOUNT_MAIL_FROM: " signin@example.test ",
    SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "   ",
    SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS: " owner@example.test ",
  });
  expect(result.env.SMALLSASS_ACCOUNT_MAIL_FROM).toBe("signin@example.test");
  expect(result.env).not.toHaveProperty("SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID");
  expect(result.env.SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS).toBe("owner@example.test");
});

it("rejects whitespace-only mode", () => {
  expect(() => resolveAccountEnvironment({ SMALLSASS_ACCOUNT_MODE: "   " })).toThrow(/contains only whitespace/);
});

it("requires a company provider in self-hosted mixed and SSO-only profiles", () => {
  for (const [profile, mode] of [
    ["self-hosted-mixed", "password-and-sso"],
    ["self-hosted-sso-only", "sso-only"],
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
      SMALLSASS_ACCOUNT_MODE: "password-only",
      ...GOOGLE,
    }),
  ).toThrow(/does not permit external identity providers/);
});
