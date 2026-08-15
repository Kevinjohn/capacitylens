import { describe, expect, it } from "vitest";
import {
  clearExternalSignInError,
  externalSignInErrorMessage,
  externalSignInErrorUrl,
  hasExternalSignInError,
} from "./externalSignInError";
import { m } from "@/i18n";

describe("external sign-in browser error URL", () => {
  it("marks the current route while preserving invitation state", () => {
    const marked = externalSignInErrorUrl("https://app.example/invite/token?source=mail");
    expect(marked).toBe("https://app.example/invite/token?source=mail&externalSignInError=1");
  });

  it("recognizes only marked provider failures and clears provider-controlled detail", () => {
    const failed =
      "https://app.example/?externalSignInError=1&error=access_denied&error_description=secret&error_uri=https%3A%2F%2Fidp.example%2Fdetail&keep=1";
    expect(hasExternalSignInError(failed)).toBe(true);
    expect(hasExternalSignInError("https://app.example/?externalSignInError=1")).toBe(true);
    expect(hasExternalSignInError("https://app.example/?error=unrelated")).toBe(false);
    expect(clearExternalSignInError(failed)).toBe("https://app.example/?keep=1");
  });
});

describe("externalSignInErrorMessage", () => {
  it("maps each application-owned code to its dedicated copy", () => {
    expect(externalSignInErrorMessage("oidc_verification_failed")).toBe(m.login_sso_verification_failed());
    expect(externalSignInErrorMessage("account_link_conflict")).toBe(m.login_sso_account_link_conflict());
  });

  it("falls back to the generic failure copy when there is no recognized code", () => {
    expect(externalSignInErrorMessage(null)).toBe(m.login_sso_failed());
  });
});
