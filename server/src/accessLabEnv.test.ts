import { describe, expect, it } from "vitest";
import { buildAccessLabEnv } from "../../scripts/access-lab-env.mjs";

describe("access lab environment isolation", () => {
  it("strips hostile deployment values and pins the fixed-credential lab to loopback", () => {
    const env = buildAccessLabEnv(
      {
        PATH: "/test/bin",
        LANG: "en_GB.UTF-8",
        CAPACITYLENS_HOST: "0.0.0.0",
        CAPACITYLENS_ALLOW_RESET: "1",
        SMALLSASS_ACCOUNT_REQUIRE_MFA: "1",
        SMALLSASS_ACCOUNT_MODE: "sso-only",
        CAPACITYLENS_SEED_DEMO: "1",
        CAPACITYLENS_HTTPS: "1",
        CAPACITYLENS_OIDC_ISSUER: "https://invalid.example",
        SMALLSASS_ACCOUNT_PUBLIC_URL: "https://canonical.invalid.example",
        SMALLSASS_ACCOUNT_SECRET: "canonical-inherited-secret",
        VITE_CAPACITYLENS_DEMO: "1",
        VITE_CAPACITYLENS_API: "https://invalid.example",
      },
      { apiPort: 8897, webPort: 5473 },
    );

    expect(env).toMatchObject({
      PATH: "/test/bin",
      LANG: "en_GB.UTF-8",
      NODE_ENV: "development",
      PORT: "8897",
      CAPACITYLENS_HOST: "127.0.0.1",
      CAPACITYLENS_ALLOW_RESET: "0",
      SMALLSASS_ACCOUNT_REQUIRE_MFA: "0",
      SMALLSASS_ACCOUNT_MODE: "password-only",
      CAPACITYLENS_SEED_DEMO: "0",
      CAPACITYLENS_HTTPS: "0",
      SMALLSASS_ACCOUNT_PUBLIC_URL: "http://127.0.0.1:8897",
      VITE_CAPACITYLENS_DEMO: "0",
      VITE_CAPACITYLENS_API: "",
    });
    expect(env.CAPACITYLENS_OIDC_ISSUER).toBeUndefined();
    expect(env.SMALLSASS_ACCOUNT_SECRET).toBe("capacitylens-access-lab-secret-0123456789abcdef");
  });
});
