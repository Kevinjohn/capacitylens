import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { countUsers, createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { insertRow, openDb } from "../db";
import { upsertMember } from "../controlTables";
import { writeJoiningPolicy } from "../controlTables/joiningPolicies";
import { canAdmitLocalExternalIdentity } from "../accounts/externalIdentityAdmission";
import {
  createJoiningProviderCallbacks,
  currentJoiningProviderFacts,
} from "../accounts/adminPort/joiningProviderCallbacks";
import { PASSWORD_ENV, readCookies, registerServerFixtureCleanup, signUp } from "../testHelpers";

const fixtures = registerServerFixtureCleanup();
const origin = PASSWORD_ENV.SMALLSASS_ACCOUNT_PUBLIC_URL;

function mockGoogle(profile: { sub: string; email: string; name: string; email_verified: boolean }) {
  const claims = {
    ...profile,
    iss: "https://accounts.google.com",
    aud: "google-client",
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString(
    "base64url",
  )}.controlled`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://oauth2.googleapis.com/token") throw new Error(`Unexpected provider request: ${url}`);
      return Response.json({
        access_token: "controlled-access",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: token,
      });
    }),
  );
}

function mockGithub(email: string, verified: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://github.com/login/oauth/access_token")
        return Response.json({ access_token: "controlled-access", token_type: "Bearer", scope: "user:email" });
      if (url === "https://api.github.com/user")
        return Response.json({
          id: "github-diana",
          email: null,
          name: "Diana Prince",
          login: "diana-prince",
          avatar_url: "https://example.test/avatar.png",
        });
      if (url === "https://api.github.com/user/emails") return Response.json([{ email, primary: true, verified }]);
      throw new Error(`Unexpected provider request: ${url}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

// eslint-disable-next-line max-lines-per-function -- The fixture hosts real provider callbacks and their minimal company setup.
async function fixture() {
  const db = fixtures.trackDb(openDb(":memory:"));
  const provider = createJoiningProviderCallbacks({
    db,
    applicationId: "capacitylens",
    secret: PASSWORD_ENV.SMALLSASS_ACCOUNT_SECRET,
    secureCookies: false,
  });
  const environment = {
    ...PASSWORD_ENV,
    SMALLSASS_ACCOUNT_MODE: "password-and-sso",
    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
    SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
    SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "github-client",
    SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "github-secret",
  };
  const { auth } = createAuthFromEnvironment(db, environment, {
    joiningProviderCallbacks: provider,
    externalIdentityAdmission: (candidate) =>
      canAdmitLocalExternalIdentity({
        bootstrapEmails: undefined,
        candidate,
        identityHasAnyPrincipal: () => countUsers(db) !== 0,
        hasLivePreauthorizedInvitation: () => false,
      }) ||
      provider.admitsNewIdentity({
        ...candidate,
        facts: currentJoiningProviderFacts(candidate.providerId),
        hasAnyPrincipal: countUsers(db) !== 0,
      }),
  });
  if (!auth) throw new Error("Expected configured authentication.");
  await runAuthMigrations(auth);
  insertRow(db, "accounts", {
    id: "a-studio",
    name: "Wayne Enterprises",
    color: "#6366f1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJoiningPolicy(db, "a-studio", { policy: "approved_domains", approvedDomains: ["studio.example"] });
  const app = fixtures.trackApp(
    createApp(db, {
      auth,
      authMode: "password-and-sso",
      multiAccount: true,
      allowOpenSignup: true,
      joiningProof: {
        secret: PASSWORD_ENV.SMALLSASS_ACCOUNT_SECRET,
        publicUrl: new URL(origin),
        sendMail: async () => {},
      },
    }),
  );
  const owner = await signUp(app, "bruce@studio.example");
  upsertMember(db, {
    accountId: "a-studio",
    userId: owner.userId,
    role: "owner",
    status: "active",
    createdAt: new Date().toISOString(),
  });
  return { db, app };
}

it("binds a new Google identity to one company intent and joins only after explicit completion", async () => {
  const { db, app } = await fixture();
  const started = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/provider/start",
    payload: { providerId: "google", purpose: "policy", email: "diana@studio.example" },
  });
  expect(started.statusCode, started.body).toBe(200);
  const url = started.json<{ url: string }>().url;
  const state = new URL(url).searchParams.get("state");
  if (!state) throw new Error("Expected native provider state.");
  const intent = db.prepare("SELECT state, providerId, providerStateHash FROM company_join_intents").get() as {
    state: string;
    providerId: string;
    providerStateHash: string;
  };
  expect(intent.state).toBe("started");
  expect(intent.providerId).toBe("google");
  expect(typeof intent.providerStateHash).toBe("string");
  expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 1 });
  mockGoogle({ sub: "google-diana", email: "diana@studio.example", name: "Diana Prince", email_verified: true });
  const callback = await app.inject({
    url: `/api/auth/callback/google?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: readCookies(started) },
  });
  expect(callback.statusCode, callback.body).toBe(302);
  expect(db.prepare("SELECT state FROM company_join_intents").get()).toEqual({ state: "approved" });
  expect(db.prepare("SELECT email, source FROM identity_email_proofs").get()).toEqual({
    email: "diana@studio.example",
    source: "google",
  });
  expect(db.prepare("SELECT COUNT(*) AS count FROM account_members").get()).toEqual({ count: 1 });
  const completed = await app.inject({
    method: "POST",
    url: "/api/company-join/complete-provider",
    headers: { cookie: `${readCookies(started)}; ${readCookies(callback)}` },
    payload: {},
  });
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json()).toMatchObject({ accountId: "a-studio", role: "viewer" });
  expect(
    db
      .prepare("SELECT role FROM account_members WHERE userId <> ?")
      .get((db.prepare("SELECT userId FROM account_members WHERE role = 'owner'").get() as { userId: string }).userId),
  ).toEqual({ role: "viewer" });
});

it("replaces a provider journey with a password journey in the same browser", async () => {
  const { db, app } = await fixture();
  const provider = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/provider/start",
    payload: { providerId: "google", purpose: "policy", email: "diana@studio.example" },
  });
  expect(provider.statusCode).toBe(200);
  const password = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/start",
    headers: { cookie: readCookies(provider) },
    payload: { purpose: "policy", email: "diana@studio.example" },
  });
  expect(password.statusCode).toBe(200);
  expect(db.prepare("SELECT state FROM company_join_intents WHERE providerId = 'google'").get()).toEqual({
    state: "cancelled",
  });
  expect(db.prepare("SELECT state FROM company_join_intents WHERE providerId = 'password'").get()).toEqual({
    state: "mail-sent",
  });
});

it("rejects a stale callback when the browser intent is absent or the joining policy changes", async () => {
  const { db, app } = await fixture();
  const started = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/provider/start",
    payload: { providerId: "google", purpose: "policy", email: "diana@studio.example" },
  });
  expect(started.statusCode).toBe(200);
  const state = new URL(started.json<{ url: string }>().url).searchParams.get("state");
  if (!state) throw new Error("Expected native provider state.");
  mockGoogle({ sub: "google-diana", email: "diana@studio.example", name: "Diana Prince", email_verified: true });
  const missingBrowser = await app.inject({
    url: `/api/auth/callback/google?code=controlled-code&state=${encodeURIComponent(state)}`,
  });
  expect(missingBrowser.statusCode).toBe(302);
  expect(missingBrowser.headers.location).toContain("company_join_expired");
  expect(countUsers(db)).toBe(1);
  writeJoiningPolicy(db, "a-studio", { policy: "invitation_only", approvedDomains: [] });
  const changedPolicy = await app.inject({
    url: `/api/auth/callback/google?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: readCookies(started) },
  });
  expect(changedPolicy.statusCode).toBe(302);
  expect(changedPolicy.headers.location).toContain("company_join_policy_changed");
  expect(countUsers(db)).toBe(1);
  expect(db.prepare("SELECT state FROM company_join_intents").get()).toEqual({ state: "started" });
});

it("does not treat another verified Google address as the intended identity", async () => {
  const { db, app } = await fixture();
  const started = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/provider/start",
    payload: { providerId: "google", purpose: "policy", email: "diana@studio.example" },
  });
  const state = new URL(started.json<{ url: string }>().url).searchParams.get("state");
  if (!state) throw new Error("Expected native provider state.");
  mockGoogle({ sub: "google-diana", email: "barbara@studio.example", name: "Barbara Gordon", email_verified: true });
  await app.inject({
    url: `/api/auth/callback/google?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: readCookies(started) },
  });
  expect(countUsers(db)).toBe(1);
  expect(db.prepare("SELECT state FROM company_join_intents").get()).toEqual({ state: "started" });
  expect(db.prepare("SELECT COUNT(*) AS count FROM account_members").get()).toEqual({ count: 1 });
});

it("admits GitHub alongside Google in mixed mode only from its selected verified callback address", async () => {
  const { db, app } = await fixture();
  const started = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/provider/start",
    payload: { providerId: "github", purpose: "policy", email: "diana@studio.example" },
  });
  expect(started.statusCode, started.body).toBe(200);
  const state = new URL(started.json<{ url: string }>().url).searchParams.get("state");
  if (!state) throw new Error("Expected native provider state.");
  mockGithub("diana@studio.example", true);
  const callback = await app.inject({
    url: `/api/auth/callback/github?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: readCookies(started) },
  });
  expect(callback.statusCode, callback.body).toBe(302);
  expect(db.prepare("SELECT state FROM company_join_intents").get()).toEqual({ state: "approved" });
  expect(db.prepare("SELECT email, source FROM identity_email_proofs").get()).toEqual({
    email: "diana@studio.example",
    source: "github",
  });
  expect(db.prepare("SELECT COUNT(*) AS count FROM account_members").get()).toEqual({ count: 1 });
  const completed = await app.inject({
    method: "POST",
    url: "/api/company-join/complete-provider",
    headers: { cookie: `${readCookies(started)}; ${readCookies(callback)}` },
    payload: {},
  });
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json()).toMatchObject({ accountId: "a-studio", role: "viewer" });
});

it("does not create a GitHub joining identity from an unverified selected address", async () => {
  const { db, app } = await fixture();
  const started = await app.inject({
    method: "POST",
    url: "/api/accounts/a-studio/join/provider/start",
    payload: { providerId: "github", purpose: "policy", email: "diana@studio.example" },
  });
  const state = new URL(started.json<{ url: string }>().url).searchParams.get("state");
  if (!state) throw new Error("Expected native provider state.");
  mockGithub("diana@studio.example", false);
  await app.inject({
    url: `/api/auth/callback/github?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: readCookies(started) },
  });
  expect(countUsers(db)).toBe(1);
  expect(db.prepare("SELECT state FROM company_join_intents").get()).toEqual({ state: "started" });
});
