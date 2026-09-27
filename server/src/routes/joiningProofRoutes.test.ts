import { describe, expect, it } from "vitest";
import { createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { createApp } from "../app";
import { writeJoiningPolicy } from "../controlTables/joiningPolicies";
import { insertRow, openDb } from "../db";
import { PASSWORD_ENV, registerServerFixtureCleanup, signUp } from "../testHelpers";

const { trackApp, trackDb } = registerServerFixtureCleanup();

async function fixture(sendMail: (email: string, token: string, accountId: string) => Promise<void>) {
  const db = trackDb(openDb(":memory:"));
  const configured = createAuthFromEnvironment(db, PASSWORD_ENV);
  if (!configured.auth) throw new Error("Expected configured authentication.");
  await runAuthMigrations(configured.auth);
  insertRow(db, "accounts", {
    id: "a-studio", name: "Wayne Enterprises", color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJoiningPolicy(db, "a-studio", { policy: "approved_domains", approvedDomains: ["studio.example"] });
  const app = trackApp(createApp(db, {
    authMode: configured.mode,
    auth: configured.auth,
    joiningProof: { secret: PASSWORD_ENV.SMALLSASS_ACCOUNT_SECRET,
      publicUrl: new URL(PASSWORD_ENV.SMALLSASS_ACCOUNT_PUBLIC_URL), sendMail },
  }));
  return { db, app };
}

function cookies(response: { headers: { "set-cookie"?: string | string[] | undefined } }): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : [raw].filter((value): value is string => typeof value === "string");
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

// eslint-disable-next-line max-lines-per-function -- These cases share one mailbox-route fixture and exercise distinct proof boundaries.
describe("company joining mailbox routes", () => {
  it("keeps the legacy invite signup from creating credentials before company-bound proof", async () => {
    const { app, db } = await fixture(async () => {});
    const response = await app.inject({ method: "POST", url: "/api/invites/old-link/signup",
      payload: { email: "diana@studio.example", name: "Diana Prince", password: "correct-horse-battery-staple" } });
    expect(response.statusCode).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_members").get()).toEqual({ count: 0 });
  });

  it("proves the mailbox in the original browser before creating password credentials and Viewer membership", async () => {
    const deliveries: string[] = [];
    const { app, db } = await fixture(async (_email, token) => { deliveries.push(token); });
    const metadata = await app.inject({ method: "GET", url: "/api/accounts/a-studio/join/metadata" });
    expect(metadata.json()).toEqual({ accountId: "a-studio", companyName: "Wayne Enterprises",
      passwordAvailable: true, providerAvailable: false });
    const started = await app.inject({ method: "POST", url: "/api/accounts/a-studio/join/start",
      payload: { purpose: "policy", email: "diana@studio.example" } });
    expect(started.statusCode).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    const cookie = cookies(started);
    expect((await app.inject({ method: "POST", url: "/api/company-join/confirm",
      payload: { token: deliveries[0] } })).statusCode).toBe(410);
    const confirmed = await app.inject({ method: "POST", url: "/api/company-join/confirm",
      headers: { cookie }, payload: { token: deliveries[0] } });
    expect(confirmed.json()).toEqual({ state: "approved" });
    const completed = await app.inject({ method: "POST", url: "/api/company-join/complete-password",
      headers: { cookie }, payload: { displayName: "Diana Prince", password: "correct-horse-battery-staple" } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ accountId: "a-studio", signInRequired: true });
    expect(db.prepare("SELECT role, status FROM account_members").get()).toEqual({ role: "viewer", status: "active" });
    expect(db.prepare("SELECT email, source FROM identity_email_proofs").get()).toEqual({
      email: "diana@studio.example", source: "password",
    });
    expect((await app.inject({ method: "POST", url: "/api/company-join/complete-password",
      headers: { cookie }, payload: { displayName: "Diana Prince", password: "correct-horse-battery-staple" } })).statusCode)
      .toBe(410);
  });

  it("keeps development signup outside companies and requires proof plus the same principal before joining", async () => {
    const deliveries: string[] = [];
    const { app, db } = await fixture(async (_email, token) => { deliveries.push(token); });
    const diana = await signUp(app, "diana@studio.example");
    const barbara = await signUp(app, "barbara@studio.example");
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_members").get()).toEqual({ count: 0 });
    const started = await app.inject({ method: "POST", url: "/api/accounts/a-studio/join/start",
      payload: { purpose: "policy", email: "diana@studio.example" } });
    const joinCookie = cookies(started);
    expect(started.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/company-join/confirm",
      headers: { cookie: joinCookie }, payload: { token: deliveries[0] } })).statusCode).toBe(200);
    const mismatch = await app.inject({ method: "POST", url: "/api/company-join/complete-existing",
      headers: { cookie: `${joinCookie}; ${barbara.cookie}` }, payload: {} });
    expect(mismatch.statusCode).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_members").get()).toEqual({ count: 0 });
    const completed = await app.inject({ method: "POST", url: "/api/company-join/complete-existing",
      headers: { cookie: `${joinCookie}; ${diana.cookie}` }, payload: {} });
    expect(completed.statusCode).toBe(200);
    expect(db.prepare("SELECT userId, role FROM account_members").get()).toEqual({ userId: diana.userId, role: "viewer" });
    expect(db.prepare("SELECT principalId, email, source FROM identity_email_proofs WHERE principalId = ?")
      .get(diana.userId)).toEqual({ principalId: diana.userId, email: "diana@studio.example", source: "password" });
  });

  it("keeps the intent retryable after mail failure and rejects a replaced token", async () => {
    let failed = true;
    const deliveries: string[] = [];
    const { app, db } = await fixture(async (_email, token) => {
      if (failed) throw new Error("SMTP private message");
      deliveries.push(token);
    });
    const started = await app.inject({ method: "POST", url: "/api/accounts/a-studio/join/start",
      payload: { purpose: "policy", email: "diana@studio.example" } });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ deliveryUnavailable: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    failed = false;
    const cookie = cookies(started);
    // The mail quota applies to retries as well as starts; the next send is allowed after its spacing window.
    db.prepare("UPDATE company_join_intents SET lastSentAt = lastSentAt - 61000").run();
    expect((await app.inject({ method: "POST", url: "/api/company-join/resend", headers: { cookie } })).statusCode)
      .toBe(200);
    expect(deliveries).toHaveLength(1);
  });
});
