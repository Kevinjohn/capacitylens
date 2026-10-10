import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment } from "../auth";

const base = {
  CAPACITYLENS_MODE: "sso-only",
  CAPACITYLENS_SECRET: "provider-retirement-secret-0123456789",
  CAPACITYLENS_PUBLIC_URL: "http://localhost:8787",
  CAPACITYLENS_GOOGLE_CLIENT_ID: "google-id",
  CAPACITYLENS_GOOGLE_CLIENT_SECRET: "google-secret",
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

describe("company provider configuration", () => {
  it("validates Microsoft independently when Google is complete", () => {
    untouchedDatabaseFailure({ ...base, CAPACITYLENS_MICROSOFT_CLIENT_ID: "partial" });
    untouchedDatabaseFailure({
      ...base,
      CAPACITYLENS_MICROSOFT_CLIENT_ID: "microsoft-id",
      CAPACITYLENS_MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      CAPACITYLENS_MICROSOFT_TENANT_ID: "common",
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
          { email: "bruce@example.com", name: "Bruce Wayne", emailVerified: true } as never,
          { path: "/callback/:id", params: { id: "google" }, bootstrapClaimToken: "held" } as never,
        ),
      ).rejects.toMatchObject({ body: { code: "EXTERNAL_IDENTITY_NOT_INVITED" } });
    } finally {
      db.close();
    }
  });
});
