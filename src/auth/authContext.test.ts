import { describe, expect, it } from "vitest";
import { resolveStrictOidcProvider, type AuthProviderInfo } from "./authContext";

// The provider-metadata predicate several SSO surfaces gate themselves on. The interesting cases are
// all the ones that must NOT count as the strict provider — a social login, and an OIDC provider the
// server flagged experimental — because letting either through would light up an enterprise-IdP
// panel for a deploy that has no enterprise IdP.

const oidc = (id: string, experimental = false): AuthProviderInfo => ({
  id,
  kind: "oidc",
  label: id,
  experimental,
});

const social: AuthProviderInfo = {
  id: "google",
  kind: "social",
  label: "Google",
  experimental: false,
};

describe("strictOidcProvider", () => {
  it("returns the non-experimental OIDC provider", () => {
    expect(resolveStrictOidcProvider([oidc("acme-idp")])).toEqual(oidc("acme-idp"));
  });

  it("ignores social providers entirely", () => {
    expect(resolveStrictOidcProvider([social])).toBeNull();
    expect(resolveStrictOidcProvider([social, oidc("acme-idp")])).toEqual(oidc("acme-idp"));
  });

  it("does not count an experimental OIDC provider as strict", () => {
    expect(resolveStrictOidcProvider([oidc("lab-idp", true)])).toBeNull();
    expect(resolveStrictOidcProvider([oidc("lab-idp", true), oidc("acme-idp")])).toEqual(oidc("acme-idp"));
  });

  it("takes the first strict provider when several are configured", () => {
    expect(resolveStrictOidcProvider([oidc("first"), oidc("second")])).toEqual(oidc("first"));
  });

  it("yields null for an absent or empty provider list rather than throwing", () => {
    expect(resolveStrictOidcProvider(undefined)).toBeNull();
    expect(resolveStrictOidcProvider(null)).toBeNull();
    expect(resolveStrictOidcProvider([])).toBeNull();
  });
});
