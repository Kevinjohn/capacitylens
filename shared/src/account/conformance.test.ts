import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CONFORMANCE_VERSION,
  ACCOUNT_CONTRACT_VERSION,
  ACCOUNT_DEPLOYMENT_PROFILES,
  ACCOUNT_PROFILE_CAPABILITIES,
  MINIMUM_ACCOUNT_SECURITY_VERSION,
} from "./conformance";

const assertCapabilityMetadataIsReadonlyAtCompileTime = (): void => {
  // @ts-expect-error Published capability objects are readonly at compile time as well as runtime.
  ACCOUNT_PROFILE_CAPABILITIES["hosted-oidc-only"].passwordSignIn = true;
};
void assertCapabilityMetadataIsReadonlyAtCompileTime;

describe("account conformance metadata", () => {
  it("publishes independent semantic versions and the complete named profile matrix", () => {
    for (const version of [ACCOUNT_CONTRACT_VERSION, ACCOUNT_CONFORMANCE_VERSION, MINIMUM_ACCOUNT_SECURITY_VERSION]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(ACCOUNT_DEPLOYMENT_PROFILES).toEqual([
      "self-hosted-password",
      "self-hosted-mixed",
      "self-hosted-sso-only",
      "hosted-oidc-only",
    ]);
    expect(ACCOUNT_PROFILE_CAPABILITIES["hosted-oidc-only"]).toEqual({
      passwordSignIn: false,
      strictOidc: true,
      hosted: true,
    });
    expect(Object.isFrozen(ACCOUNT_PROFILE_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(ACCOUNT_PROFILE_CAPABILITIES["hosted-oidc-only"])).toBe(true);
  });
});
