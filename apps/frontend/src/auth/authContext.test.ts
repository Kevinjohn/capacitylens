import { describe, expect, it } from "vitest";
import { isSupportedSocialProviderId, hasGoogleProviderBrand } from "./authContext";

describe("named provider metadata", () => {
  it.each(["google", "microsoft", "github"])("recognizes %s", (id) => {
    expect(isSupportedSocialProviderId(id)).toBe(true);
  });
  it.each(["sso", "workforce", "", null, undefined, 1])("rejects unsupported provider %s", (id) => {
    expect(isSupportedSocialProviderId(id)).toBe(false);
  });
  it("recognizes Google without older-server brand metadata", () => {
    expect(hasGoogleProviderBrand({ id: "google", kind: "social" })).toBe(true);
    expect(hasGoogleProviderBrand({ id: "microsoft", kind: "social" })).toBe(false);
    expect(hasGoogleProviderBrand({ id: "github", kind: "social" })).toBe(false);
  });
});
