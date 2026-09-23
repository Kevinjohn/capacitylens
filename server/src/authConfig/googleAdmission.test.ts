import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { countUsers, createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { insertRow, openDb } from "../db";
import { createInvite, getInvite, upsertMember } from "../controlTables";
import { canAdmitLocalExternalIdentity } from "../accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "../accounts/sqliteAccountAdminPort";
import { PASSWORD_ENV, readCookies, registerServerFixtureCleanup } from "../testHelpers";

const fixtures = registerServerFixtureCleanup();
const origin = "http://localhost:8787";
const ownerEmail = "bruce@example.test";

type GoogleProfile = { sub: string; email: string; name: string; email_verified: boolean };
const owner: GoogleProfile = { sub: "google-bruce", email: ownerEmail, name: "Bruce Wayne", email_verified: true };

function mockGoogle(profile: GoogleProfile): void {
  const claims = {
    ...profile,
    iss: "https://accounts.google.com",
    aud: "google-client",
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.controlled`;
  // Native code flow obtains this token from Google's fixed TLS endpoint. Keep the real provider
  // mapper, database hooks, invitation admission and callback handler in the test path.
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

afterEach(() => vi.unstubAllGlobals());

async function configured(mode: "password" | "sso" = "sso") {
  const db = fixtures.trackDb(openDb(":memory:"));
  const { auth } = createAuthFromEnvironment(
    db,
    {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: mode,
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID: "google-client",
      SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET: "google-secret",
      SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS: ownerEmail,
    },
    {
      externalIdentityAdmission: (candidate) =>
        canAdmitLocalExternalIdentity({
          bootstrapEmails: ownerEmail,
          candidate,
          identityHasAnyPrincipal: () => countUsers(db) > 0,
          hasLivePreauthorizedInvitation: (email) => hasLivePreauthorizedInvitation(db, email),
        }),
    },
  );
  if (!auth) throw new Error("Expected Google authentication.");
  await runAuthMigrations(auth);
  const app = fixtures.trackApp(createApp(db, { auth, authMode: mode, multiAccount: true, allowOpenSignup: true }));
  return { db, auth, app };
}

type Fixture = Awaited<ReturnType<typeof configured>>;

async function finishGoogle(
  fixture: Fixture,
  { url, cookie, profile }: { url: string; cookie: string; profile: GoogleProfile },
) {
  const state = new URL(url).searchParams.get("state");
  if (!state) throw new Error("Expected native OAuth state.");
  mockGoogle(profile);
  return fixture.app.inject({
    url: `/api/auth/callback/google?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie },
  });
}

async function signInGoogle(fixture: Fixture, profile: GoogleProfile, callbackURL = `${origin}/`) {
  const started = await fixture.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/social",
    payload: { provider: "google", callbackURL, errorCallbackURL: `${origin}/?externalSignInError=1` },
  });
  expect(started.statusCode, started.body).toBe(200);
  return finishGoogle(fixture, { url: started.json<{ url: string }>().url, cookie: readCookies(started), profile });
}

function principalId(fixture: Fixture, email: string): string {
  const row = fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string } | undefined;
  if (!row) throw new Error(`Expected admitted fixture principal: ${email}`);
  return row.id;
}

function invite(fixture: Fixture, email: string) {
  const now = new Date().toISOString();
  insertRow(fixture.db, "accounts", {
    id: "a-studio",
    name: "Wayne Enterprises",
    color: "#6366f1",
    createdAt: now,
    updatedAt: now,
  });
  upsertMember(fixture.db, {
    accountId: "a-studio",
    userId: principalId(fixture, ownerEmail),
    role: "owner",
    status: "active",
    createdAt: now,
  });
  const token = "google-admission-invite-token";
  createInvite(fixture.db, {
    token,
    id: "google-invite",
    accountId: "a-studio",
    role: "editor",
    preauthEmail: email,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    usedAt: null,
    createdAt: now,
  });
  return token;
}

it("admits the allowlisted first owner and returns to the same principal without another invitation", async () => {
  const fixture = await configured();
  const first = await signInGoogle(fixture, owner);
  expect(first.statusCode, first.body).toBe(302);
  const id = principalId(fixture, ownerEmail);
  const returned = await signInGoogle(fixture, owner);
  expect(returned.statusCode, returned.body).toBe(302);
  expect(countUsers(fixture.db)).toBe(1);
  expect(principalId(fixture, ownerEmail)).toBe(id);
  const me = await fixture.app.inject({ url: "/api/auth/me", headers: { cookie: readCookies(returned) } });
  expect(me.statusCode, me.body).toBe(200);
  expect(me.json()).toMatchObject({ user: { id, email: ownerEmail } });
});

it.each([
  { ...owner, email: "diana@example.test", sub: "google-diana", name: "Diana Prince" },
  { ...owner, email_verified: false },
])("rejects an unauthorized first-owner identity ($email, verified $email_verified)", async (profile) => {
  const fixture = await configured();
  await signInGoogle(fixture, profile);
  expect(countUsers(fixture.db)).toBe(0);
  expect(fixture.db.prepare("SELECT id FROM session").all()).toEqual([]);
  expect(fixture.db.prepare("SELECT id FROM account").all()).toEqual([]);
});

it("admits an addressed invite without claiming membership until explicit acceptance", async () => {
  const fixture = await configured();
  await signInGoogle(fixture, owner);
  const email = "diana@example.test";
  const token = invite(fixture, email);
  const result = await signInGoogle(
    fixture,
    { ...owner, sub: "google-diana", email, name: "Diana Prince" },
    `${origin}/invite/${token}`,
  );
  expect(result.statusCode, result.body).toBe(302);
  const id = principalId(fixture, email);
  expect(getInvite(fixture.db, token)?.usedAt).toBeNull();
  expect(fixture.db.prepare("SELECT accountId FROM account_members WHERE userId = ?").all(id)).toEqual([]);
  const accepted = await fixture.app.inject({
    method: "POST",
    url: `/api/invites/${token}/accept`,
    headers: { cookie: readCookies(result) },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(getInvite(fixture.db, token)?.usedAt).not.toBeNull();
  expect(fixture.db.prepare("SELECT accountId, role FROM account_members WHERE userId = ?").all(id)).toEqual([
    { accountId: "a-studio", role: "editor" },
  ]);
  const replay = await fixture.app.inject({
    method: "POST",
    url: `/api/invites/${token}/accept`,
    headers: { cookie: readCookies(result) },
  });
  expect(replay.statusCode).toBe(409);
});

it("rejects an uninvited new identity once an owner exists", async () => {
  const fixture = await configured();
  await signInGoogle(fixture, owner);
  await signInGoogle(fixture, { ...owner, sub: "google-diana", email: "diana@example.test", name: "Diana Prince" });
  expect(countUsers(fixture.db)).toBe(1);
  expect(fixture.db.prepare("SELECT accountId FROM account WHERE providerId = 'google'").all()).toEqual([
    { accountId: owner.sub },
  ]);
});

it("requires explicit linking for a matching password identity, then returns as that same principal", async () => {
  const fixture = await configured("password");
  const local = await fixture.app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email: ownerEmail, name: "Bruce Wayne", password: "password-123456" },
  });
  expect(local.statusCode, local.body).toBe(200);
  const id = principalId(fixture, ownerEmail);
  fixture.db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(id);
  await signInGoogle(fixture, owner);
  expect(fixture.db.prepare("SELECT id FROM account WHERE providerId = 'google'").all()).toEqual([]);
  const cookie = readCookies(local);
  const linked = await fixture.app.inject({
    method: "POST",
    url: "/api/identity/link-provider",
    headers: { cookie },
    payload: { providerId: "google", callbackURL: `${origin}/account`, errorCallbackURL: `${origin}/account` },
  });
  expect(linked.statusCode, linked.body).toBe(200);
  const completed = await finishGoogle(fixture, {
    url: linked.json<{ url: string }>().url,
    cookie: `${cookie}; ${readCookies(linked)}`,
    profile: owner,
  });
  expect(completed.statusCode, completed.body).toBe(302);
  expect(fixture.db.prepare("SELECT userId FROM account WHERE providerId = 'google'").get()).toEqual({ userId: id });
  const returned = await signInGoogle(fixture, owner);
  expect(returned.statusCode, returned.body).toBe(302);
  expect(countUsers(fixture.db)).toBe(1);
  expect(principalId(fixture, ownerEmail)).toBe(id);
});
