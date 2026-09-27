import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment } from "../auth";

const base = {
  SMALLSASS_ACCOUNT_MODE: "sso-only",
  SMALLSASS_ACCOUNT_SECRET: "provider-retirement-secret-0123456789",
  SMALLSASS_ACCOUNT_PUBLIC_URL: "http://localhost:8787",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-id",
  SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
};

function untouchedDatabaseFailure(environment: Record<string, string>): void {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  try {
    expect(() => createAuthFromEnvironment(db, environment)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
  } finally {
    db.close();
  }
}

describe("retired generic identity configuration", () => {
  it("refuses old generic settings before creating storage even with a valid company provider", () => {
    untouchedDatabaseFailure({ ...base, SMALLSASS_ACCOUNT_OIDC_CLIENT_ID: "retired" });
    untouchedDatabaseFailure({ ...base, CAPACITYLENS_SSO_ISSUER: "https://old.example" });
    untouchedDatabaseFailure({ ...base, SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE: "hosted-oidc-only" });
  });

  it("validates Microsoft independently when Google is complete", () => {
    untouchedDatabaseFailure({ ...base, SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "partial" });
    untouchedDatabaseFailure({
      ...base,
      SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_ID: "microsoft-id",
      SMALLSASS_ACCOUNT_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID: "common",
    });
  });

  it("does not admit an uninvited verified Google identity in provider-required mode", async () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    try {
      const { auth } = createAuthFromEnvironment(db, base, {
        deferDatabaseSetup: true,
        externalIdentityAdmission: () => false,
      });
      if (!auth) throw new Error("Expected SSO auth");
      const before = auth.options.databaseHooks?.user?.create?.before;
      if (!before) throw new Error("Expected external admission hook");
      await expect(
        before(
          { email: "bruce@example.com", emailVerified: true } as never,
          { path: "/callback/:id", params: { id: "google" }, bootstrapClaimToken: "held" } as never,
        ),
      ).rejects.toMatchObject({ body: { code: "EXTERNAL_IDENTITY_NOT_INVITED" } });
    } finally {
      db.close();
    }
  });
});
