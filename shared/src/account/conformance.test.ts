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
    expect(ACCOUNT_PROFILE_CAPABILITIES).toEqual({
      "self-hosted-password": { passwordSignIn: true, strictOidc: false, hosted: false },
      "self-hosted-mixed": { passwordSignIn: true, strictOidc: true, hosted: false },
      "self-hosted-sso-only": { passwordSignIn: false, strictOidc: true, hosted: false },
      "hosted-oidc-only": { passwordSignIn: false, strictOidc: true, hosted: true },
    });
    expect(Object.isFrozen(ACCOUNT_PROFILE_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(ACCOUNT_DEPLOYMENT_PROFILES)).toBe(true);
    for (const profile of ACCOUNT_DEPLOYMENT_PROFILES) {
      expect(Object.isFrozen(ACCOUNT_PROFILE_CAPABILITIES[profile])).toBe(true);
    }
  });
});
