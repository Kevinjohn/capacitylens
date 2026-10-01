import { describe, expect, it } from "vitest";
import { resolveAccountEnvironment } from "./accountConfig";

const GOOGLE = {
  CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
  CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
};
const MICROSOFT = {
  CAPACITYLENS_MICROSOFT_CLIENT_ID: "microsoft-client",
  CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  CAPACITYLENS_MICROSOFT_TENANT_ID: "01234567-89ab-cdef-0123-456789abcdef",
};
const HOSTED = {
  CAPACITYLENS_DEPLOYMENT_PROFILE: "hosted-sso-only",
  CAPACITYLENS_MODE: "sso-only",
  ...GOOGLE,
};

describe("hosted provider-only profile", () => {
  it("accepts Google, tenant-specific Microsoft, or both", () => {
    for (const providers of [GOOGLE, MICROSOFT, { ...GOOGLE, ...MICROSOFT }]) {
      expect(
        resolveAccountEnvironment({
          CAPACITYLENS_DEPLOYMENT_PROFILE: "hosted-sso-only",
          CAPACITYLENS_MODE: "sso-only",
          ...providers,
        }).profile,
      ).toBe("hosted-sso-only");
    }
  });

  it.each([
    [{ CAPACITYLENS_MODE: "password-only" }, /hosted password accounts are prohibited/i],
    [{ CAPACITYLENS_ALLOW_OPEN_SIGNUP: "1" }, /forbids open signup/i],
    [{ CAPACITYLENS_SETUP_TOKEN: "setup" }, /password-account configuration/i],
    [{ CAPACITYLENS_CREATE_ADMIN_ADMIN: "1" }, /password-account configuration/i],
    [{ CAPACITYLENS_GITHUB_CLIENT_ID: "partial" }, /forbids GitHub/i],
    [{ CAPACITYLENS_GITHUB_CLIENT_SECRET: "partial" }, /forbids GitHub/i],
  ] as const)("rejects incompatible hosted configuration %#", (override, error) => {
    expect(() => resolveAccountEnvironment({ ...HOSTED, ...override })).toThrow(error);
  });

  it("rejects a missing company provider", () => {
    expect(() =>
      resolveAccountEnvironment({
        ...HOSTED,
        CAPACITYLENS_GOOGLE_CLIENT_ID: undefined,
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: undefined,
      }),
    ).toThrow(/Google or tenant-specific Microsoft/);
  });
});

it("normalizes supported settings and preserves secrets", () => {
  const secret = `  ${"x".repeat(32)}  `;
  const result = resolveAccountEnvironment({
    CAPACITYLENS_MODE: " password-only ",
    CAPACITYLENS_SECRET: secret,
    CAPACITYLENS_PUBLIC_URL: " https://capacity.example.test ",
  });
  expect(result.env.CAPACITYLENS_MODE).toBe("password-only");
  expect(result.env.CAPACITYLENS_SECRET).toBe(secret);
  expect(result.env.CAPACITYLENS_PUBLIC_URL).toBe("https://capacity.example.test");
  expect(resolveAccountEnvironment(result.env).env).toBe(result.env);
});

it("trims provider and mail settings and drops whitespace-only ones", () => {
  const result = resolveAccountEnvironment({
    CAPACITYLENS_MAIL_FROM: " signin@example.test ",
    CAPACITYLENS_MICROSOFT_TENANT_ID: "   ",
    CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS: " owner@example.test ",
  });
  expect(result.env.CAPACITYLENS_MAIL_FROM).toBe("signin@example.test");
  expect(result.env).not.toHaveProperty("CAPACITYLENS_MICROSOFT_TENANT_ID");
  expect(result.env.CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS).toBe("owner@example.test");
});

it("rejects whitespace-only mode", () => {
  expect(() => resolveAccountEnvironment({ CAPACITYLENS_MODE: "   " })).toThrow(/contains only whitespace/);
});

it("requires a company provider in self-hosted mixed and SSO-only profiles", () => {
  for (const [profile, mode] of [
    ["self-hosted-mixed", "password-and-sso"],
    ["self-hosted-sso-only", "sso-only"],
  ]) {
    expect(() =>
      resolveAccountEnvironment({ CAPACITYLENS_DEPLOYMENT_PROFILE: profile, CAPACITYLENS_MODE: mode }),
    ).toThrow(/Google or tenant-specific Microsoft/);
    expect(() =>
      resolveAccountEnvironment({
        CAPACITYLENS_DEPLOYMENT_PROFILE: profile,
        CAPACITYLENS_MODE: mode,
        ...GOOGLE,
      }),
    ).not.toThrow();
  }
});

it("rejects external providers in self-hosted password-only profile", () => {
  expect(() =>
    resolveAccountEnvironment({
      CAPACITYLENS_DEPLOYMENT_PROFILE: "self-hosted-password",
      CAPACITYLENS_MODE: "password-only",
      ...GOOGLE,
    }),
  ).toThrow(/does not permit external identity providers/);
});
