import { expect, it } from "vitest";
import { resolveAccountEnvironment } from "./accountConfig";

const hosted = {
  SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "hosted-oidc-only",
  SMALLSASS_ACCOUNT_MODE: "sso",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
  SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
  SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://idp.example/.well-known/openid-configuration",
  SMALLSASS_ACCOUNT_OIDC_ISSUER: "https://idp.example",
};

function expectHostedConfigError(override: Record<string, string | undefined>, message: string | RegExp): void {
  expect(() => resolveAccountEnvironment({ ...hosted, ...override })).toThrow(message);
}

const retiredAccountNames = [
  ["CAPACITYLENS_AUTH", "SMALLSASS_ACCOUNT_MODE"],
  ["BETTER_AUTH_SECRET", "SMALLSASS_ACCOUNT_SECRET"],
  ["BETTER_AUTH_URL", "SMALLSASS_ACCOUNT_PUBLIC_URL"],
  ["CAPACITYLENS_SETUP_TOKEN", "SMALLSASS_ACCOUNT_SETUP_TOKEN"],
  ["CAPACITYLENS_ALLOW_OPEN_SIGNUP", "SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP"],
  ["CAPACITYLENS_REQUIRE_MFA", "SMALLSASS_ACCOUNT_REQUIRE_MFA"],
  ["CAPACITYLENS_PASSWORD_BREACH_CHECK", "SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK"],
  ["CAPACITYLENS_SSO_MFA_ENFORCED", "SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED"],
  ["CAPACITYLENS_SSO_CLIENT_ID", "SMALLSASS_ACCOUNT_OIDC_CLIENT_ID"],
  ["CAPACITYLENS_SSO_CLIENT_SECRET", "SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET"],
  ["CAPACITYLENS_SSO_DISCOVERY_URL", "SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL"],
  ["CAPACITYLENS_SSO_ISSUER", "SMALLSASS_ACCOUNT_OIDC_ISSUER"],
  ["CAPACITYLENS_SSO_AUTHORIZATION_URL", "SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL"],
  ["CAPACITYLENS_SSO_TOKEN_URL", "SMALLSASS_ACCOUNT_OIDC_TOKEN_URL"],
  ["CAPACITYLENS_SSO_SCOPES", "SMALLSASS_ACCOUNT_OIDC_SCOPES"],
  ["CAPACITYLENS_SSO_PROVIDER_ID", "SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID"],
  ["CAPACITYLENS_SSO_LABEL", "SMALLSASS_ACCOUNT_OIDC_LABEL"],
  ["CAPACITYLENS_SSO_BRAND", "SMALLSASS_ACCOUNT_OIDC_BRAND"],
  ["CAPACITYLENS_SSO_BOOTSTRAP_EMAILS", "SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS"],
  ["CAPACITYLENS_GOOGLE_CLIENT_ID", "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID"],
  ["CAPACITYLENS_GOOGLE_CLIENT_SECRET", "SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET"],
  ["CAPACITYLENS_MICROSOFT_CLIENT_ID", "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID"],
  ["CAPACITYLENS_MICROSOFT_CLIENT_SECRET", "SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET"],
  ["CAPACITYLENS_MICROSOFT_TENANT_ID", "SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID"],
  ["CAPACITYLENS_GITHUB_CLIENT_ID", "SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID"],
  ["CAPACITYLENS_GITHUB_CLIENT_SECRET", "SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET"],
] as const;

it.each(retiredAccountNames)("refuses retired %s and names %s", (retired, canonical) => {
  expect(() => resolveAccountEnvironment({ [retired]: "configured" })).toThrow(
    `${retired} was removed; use ${canonical}`,
  );
});

it("treats empty retired Compose placeholders as absent", () => {
  expect(() =>
    resolveAccountEnvironment({
      CAPACITYLENS_AUTH: "",
      BETTER_AUTH_SECRET: "",
      BETTER_AUTH_URL: "",
    }),
  ).not.toThrow();
});

it("refuses whitespace-only retired values", () => {
  expect(() => resolveAccountEnvironment({ CAPACITYLENS_AUTH: " \t" })).toThrow(
    "CAPACITYLENS_AUTH was removed; use SMALLSASS_ACCOUNT_MODE",
  );
});

it("refuses a retired name even when its canonical value matches", () => {
  expect(() =>
    resolveAccountEnvironment({
      CAPACITYLENS_AUTH: "password",
      SMALLSASS_ACCOUNT_MODE: "password",
    }),
  ).toThrow("CAPACITYLENS_AUTH was removed; use SMALLSASS_ACCOUNT_MODE");
});

it("normalizes canonical settings without compatibility writes", () => {
  const resolved = resolveAccountEnvironment({
    SMALLSASS_ACCOUNT_MODE: " password ",
    SMALLSASS_ACCOUNT_OIDC_SCOPES: " openid   profile  email ",
  });
  expect(resolved.env.SMALLSASS_ACCOUNT_MODE).toBe("password");
  expect(resolved.env.SMALLSASS_ACCOUNT_OIDC_SCOPES).toBe("openid profile email");
  expect(resolved.env.CAPACITYLENS_AUTH).toBeUndefined();
  expect(resolved.env.CAPACITYLENS_SSO_SCOPES).toBeUndefined();
});

it("returns an already resolved canonical environment unchanged", () => {
  const first = resolveAccountEnvironment({ SMALLSASS_ACCOUNT_MODE: "off" });
  const second = resolveAccountEnvironment(first.env);

  expect(second.env).toBe(first.env);
  expect(second.profile).toBe(first.profile);
});

it("refuses a retired name added to an already resolved environment", () => {
  const resolved = resolveAccountEnvironment({ SMALLSASS_ACCOUNT_MODE: "off" });
  resolved.env.CAPACITYLENS_AUTH = "off";

  expect(() => resolveAccountEnvironment(resolved.env)).toThrow(
    "CAPACITYLENS_AUTH was removed; use SMALLSASS_ACCOUNT_MODE",
  );
});

it.each([
  ["SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP", "1"],
  ["SMALLSASS_ACCOUNT_REQUIRE_MFA", "1"],
  ["SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK", "off"],
  ["SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED", "1"],
] as const)("trims padded %s values", (canonical, value) => {
  const resolved = resolveAccountEnvironment({ [canonical]: `  ${value} \n` });
  expect(resolved.env[canonical]).toBe(value);
});

it("keeps secret values byte-exact while normalizing non-secret settings", () => {
  const secret = `  ${"x".repeat(32)}  `;
  const resolved = resolveAccountEnvironment({
    SMALLSASS_ACCOUNT_SECRET: secret,
    SMALLSASS_ACCOUNT_PUBLIC_URL: "  https://capacity.example.test  ",
  });
  expect(resolved.env.SMALLSASS_ACCOUNT_SECRET).toBe(secret);
  expect(resolved.env.SMALLSASS_ACCOUNT_PUBLIC_URL).toBe("https://capacity.example.test");
});

it("treats empty Compose placeholders as absent", () => {
  const resolved = resolveAccountEnvironment({
    SMALLSASS_ACCOUNT_MODE: "",
    SMALLSASS_ACCOUNT_SECRET: "   ",
  });
  expect(resolved.env.SMALLSASS_ACCOUNT_MODE).toBeUndefined();
  expect(resolved.env.SMALLSASS_ACCOUNT_SECRET).toBeUndefined();
});

it("refuses a whitespace-only mode instead of resolving trusted-local mode", () => {
  expect(() => resolveAccountEnvironment({ SMALLSASS_ACCOUNT_MODE: "   " })).toThrow(
    "SMALLSASS_ACCOUNT_MODE contains only whitespace",
  );
});

it("accepts a complete hosted OIDC-only discovery configuration", () => {
  const resolved = resolveAccountEnvironment({
    ...hosted,
    SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS: "owner@example.com",
  });
  expect(resolved.profile).toBe("hosted-oidc-only");
  expect(resolved.env.SMALLSASS_ACCOUNT_MODE).toBe("sso");
});

it.each([
  [{ SMALLSASS_ACCOUNT_MODE: "password" }, /hosted password accounts are prohibited/i],
  [{ SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: undefined }, /discovery/i],
  [{ SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1" }, /open signup/i],
  [{ SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google" }, /strict OIDC provider/i],
  [{ SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "tenant-only" }, /strict OIDC provider/i],
  [{ SMALLSASS_ACCOUNT_SETUP_TOKEN: "password-setup" }, /password-account configuration/i],
  [{ SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL: "https://idp.example/authorize" }, /endpoint overrides/i],
] as const)("refuses invalid hosted OIDC-only configuration %#", (override, message) => {
  expectHostedConfigError(override, message);
});

it("requires strict OIDC material for mixed and SSO-only named profiles", () => {
  expect(() =>
    resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-mixed",
      SMALLSASS_ACCOUNT_MODE: "password",
    }),
  ).toThrow(/strict OIDC/i);
  expect(() =>
    resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-mixed",
      SMALLSASS_ACCOUNT_MODE: "password",
    }),
  ).not.toThrow();
  expect(() =>
    resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-sso-only",
    }),
  ).not.toThrow();
});

it("keeps experimental social providers compatible while requiring closed signup in self-hosted SSO-only", () => {
  expect(() =>
    resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-sso-only",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    }),
  ).not.toThrow();
  expect(() =>
    resolveAccountEnvironment({
      ...hosted,
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-sso-only",
      SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: "1",
    }),
  ).toThrow(/forbids open signup/i);
});

it("refuses external provider configuration in the password-only profile", () => {
  expect(() =>
    resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-password",
      SMALLSASS_ACCOUNT_MODE: "password",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    }),
  ).toThrow(/does not permit external identity providers/i);
  expect(() =>
    resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-password",
      SMALLSASS_ACCOUNT_MODE: "password",
      SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "client-id",
      SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET: "client-secret",
    }),
  ).toThrow(/does not permit external identity providers/i);
  expect(() =>
    resolveAccountEnvironment({
      SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "self-hosted-password",
      SMALLSASS_ACCOUNT_MODE: "password",
      SMALLSASS_ACCOUNT_OIDC_LABEL: "unused-but-misleading",
    }),
  ).toThrow(/does not permit external identity providers/i);
});
