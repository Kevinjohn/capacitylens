import { describe, expect, it } from "vitest";
import { isSupportedSocialProviderId, hasGoogleProviderBrand } from "./authContext";

describe("named provider metadata", () => {
  it("recognizes Google", () => {
    expect(isSupportedSocialProviderId("google")).toBe(true);
  });
  it.each(["microsoft", "github", "sso", "workforce", "", null, undefined, 1])(
    "rejects unsupported provider %s",
    (id) => {
      expect(isSupportedSocialProviderId(id)).toBe(false);
    },
  );
  it("recognizes Google without older-server brand metadata", () => {
    expect(hasGoogleProviderBrand({ id: "google", kind: "social" })).toBe(true);
    expect(hasGoogleProviderBrand({ id: "microsoft", kind: "social" })).toBe(false);
    expect(hasGoogleProviderBrand({ id: "github", kind: "social" })).toBe(false);
  });
});
