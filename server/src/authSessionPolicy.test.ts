import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createAuthFromEnvironment } from "./auth";
import { assertPresent, openDb, PASSWORD_ENV } from "./authTestSupport";

describe("resolved auth options", () => {
  const companyProviderEnv = {
    CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",

    CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
  };

  it.each([
    {
      name: "password",
      env: PASSWORD_ENV,
      trustedOrigins: undefined,
      pluginIds: [],
    },
    {
      name: "password with providers",
      env: {
        ...PASSWORD_ENV,
        ...companyProviderEnv,
        CAPACITYLENS_GOOGLE_CLIENT_ID: "google-client",
        CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
      },
      trustedOrigins: ["https://admin.example", "https://capacity.example"],
      pluginIds: [],
    },
    {
      name: "sso",
      env: { ...PASSWORD_ENV, ...companyProviderEnv, CAPACITYLENS_MODE: "sso-only" },
      trustedOrigins: ["https://capacity.example"],
      pluginIds: [],
    },
  ])("pins security-sensitive option fields in $name mode", ({ env, trustedOrigins, pluginIds }) => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    const { auth } = createAuthFromEnvironment(db, env, {
      deferDatabaseSetup: true,
      ...(trustedOrigins === undefined ? {} : { trustedOrigins }),
    });
    const configuredAuth = assertPresent(auth, `${env.CAPACITYLENS_MODE} auth`);

    expect(configuredAuth.options.telemetry?.enabled).toBe(false);
    expect(configuredAuth.options.verification?.storeIdentifier).toBe("hashed");
    expect(configuredAuth.options.plugins?.map((plugin) => plugin.id) ?? []).toEqual(pluginIds);
    expect(configuredAuth.options.trustedOrigins).toEqual(trustedOrigins);
    db.close();
  });
});

const registerCookieHardeningTests = () => {
  it("pins sameSite:lax + httpOnly on the session cookie", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    expect(passwordAuth.options.advanced?.defaultCookieAttributes).toEqual({ sameSite: "lax", httpOnly: true });
    expect(passwordAuth.options.advanced?.cookiePrefix).toBe("capacitylens");
  });

  it("derives an insecure development cookie from an HTTP public URL", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    expect(assertPresent(auth, "password auth").options.advanced?.useSecureCookies).toBe(false);
  });

  it("sets a valid __Host prefix and Secure from the HTTPS public URL even behind an HTTP proxy hop", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), {
      ...PASSWORD_ENV,
      CAPACITYLENS_PUBLIC_URL: "https://capacity.example",
    });
    const passwordAuth = assertPresent(auth, "password auth");
    // Better Auth's built-in switch is deliberately false because it prepends `__Secure-`.
    // CapacityLens supplies Secure directly so the stricter `__Host-` prefix remains first.
    expect(passwordAuth.options.advanced?.useSecureCookies).toBe(false);
    expect(passwordAuth.options.advanced?.cookiePrefix).toBe("__Host-capacitylens");
    expect(passwordAuth.options.advanced?.defaultCookieAttributes).toEqual({
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("refuses a plaintext non-loopback public URL in production", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        NODE_ENV: "production",
        CAPACITYLENS_PUBLIC_URL: "http://capacity.example",
      }),
    ).toThrow(/must use https:\/\//);
  });

  it("inherits the production HTTPS posture when an explicit environment omits NODE_ENV", () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createAuthFromEnvironment(openDb(":memory:"), {
          ...PASSWORD_ENV,
          CAPACITYLENS_PUBLIC_URL: "http://capacity.example",
        }),
      ).toThrow(/must use https:\/\//);
    } finally {
      if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnvironment;
    }
  });

  it("still permits loopback HTTP for a local production-container check", () => {
    expect(() =>
      createAuthFromEnvironment(openDb(":memory:"), {
        ...PASSWORD_ENV,
        NODE_ENV: "production",
        CAPACITYLENS_PUBLIC_URL: "http://localhost:8787",
      }),
    ).not.toThrow();
  });
};

const registerSessionHardeningTests = () => {
  it("pins a 12-hour absolute lifetime with no sliding refresh and a 15-minute fresh window", () => {
    const { auth } = createAuthFromEnvironment(openDb(":memory:"), PASSWORD_ENV);
    const passwordAuth = assertPresent(auth, "password auth");
    expect(passwordAuth.options.session?.expiresIn).toBe(43_200);
    expect(passwordAuth.options.session?.disableSessionRefresh).toBe(true);
    expect(passwordAuth.options.session?.freshAge).toBe(900);
  });

  it("constructs no betterAuth instance for an absent or explicit off mode", () => {
    for (const environment of [{}, { CAPACITYLENS_MODE: "off" }]) {
      expect(createAuthFromEnvironment(openDb(":memory:"), environment)).toMatchObject({ mode: "off", auth: null });
    }
  });
};

describe("cookie/session hardening (P1.16)", () => {
  registerCookieHardeningTests();
  registerSessionHardeningTests();
});
