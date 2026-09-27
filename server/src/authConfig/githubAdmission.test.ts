import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { countUsers, createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { openDb } from "../db";
import { createInvite, getInvite, getMemberRole, isAccessRestricted, upsertMember } from "../controlTables";
import { canAdmitLocalExternalIdentity } from "../accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "../accounts/sqliteAccountAdminPort";
import { PASSWORD_ENV, readCookies, registerServerFixtureCleanup, signUp } from "../testHelpers";

const fixtures = registerServerFixtureCleanup();
const ownerEmail = "bruce@example.test";
const origin = "http://localhost:8787";

type GithubProfile = { id: string; email: string | null; name: string; login: string; avatar_url: string };

function mockGithub(
  profile: GithubProfile,
  emails: Array<{ email: string; primary: boolean; verified: boolean }> | null,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://github.com/login/oauth/access_token")
        return Response.json({ access_token: "controlled-access", token_type: "Bearer", scope: "user:email" });
      if (url === "https://api.github.com/user") return Response.json(profile);
      if (url === "https://api.github.com/user/emails")
        return emails === null ? new Response(null, { status: 503 }) : Response.json(emails);
      throw new Error(`Unexpected provider request: ${url}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

async function configured() {
  const db = fixtures.trackDb(openDb(":memory:"));
  const { auth } = createAuthFromEnvironment(
    db,
    {
      ...PASSWORD_ENV,
      SMALLSASS_ACCOUNT_MODE: "password-and-sso",
      SMALLSASS_ACCOUNT_GITHUB_CLIENT_ID: "github-client",
      SMALLSASS_ACCOUNT_GITHUB_CLIENT_SECRET: "github-secret",
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
  if (!auth) throw new Error("Expected GitHub authentication.");
  await runAuthMigrations(auth);
  const app = fixtures.trackApp(
    createApp(db, { auth, authMode: "password-and-sso", multiAccount: true, allowOpenSignup: true }),
  );
  return { db, app };
}

async function signInGithub(
  fixture: Awaited<ReturnType<typeof configured>>,
  profile: GithubProfile,
  emails: Array<{ email: string; primary: boolean; verified: boolean }> | null,
) {
  const started = await fixture.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/social",
    payload: { provider: "github", callbackURL: `${origin}/`, errorCallbackURL: `${origin}/?externalSignInError=1` },
  });
  expect(started.statusCode, started.body).toBe(200);
  const state = new URL(started.json<{ url: string }>().url).searchParams.get("state");
  if (!state) throw new Error("Expected OAuth state.");
  mockGithub(profile, emails);
  return fixture.app.inject({
    url: `/api/auth/callback/github?code=controlled-code&state=${encodeURIComponent(state)}`,
    headers: { cookie: readCookies(started) },
  });
}

const bruce: GithubProfile = {
  id: "github-bruce",
  email: null,
  name: "Bruce Wayne",
  login: "bruce-wayne",
  avatar_url: "https://example.test/avatar.png",
};

type Fixture = Awaited<ReturnType<typeof configured>>;

async function createCompany(fixture: Fixture, ownerCookie: string): Promise<void> {
  const created = await fixture.app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: { cookie: ownerCookie },
    payload: { id: "a-studio", name: "Wayne Enterprises", color: "#3b82f6" },
  });
  expect(created.statusCode, created.body).toBe(201);
}

async function disableMember(fixture: Fixture, ownerCookie: string, principalId: string): Promise<void> {
  const disabled = await fixture.app.inject({
    method: "PATCH",
    url: `/api/accounts/a-studio/members/${principalId}/status`,
    headers: { cookie: ownerCookie },
    payload: { status: "disabled" },
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
}

it("records the exact address selected and verified by GitHub", async () => {
  const fixture = await configured();
  const response = await signInGithub(fixture, bruce, [{ email: ownerEmail, primary: true, verified: true }]);
  expect(response.statusCode, response.body).toBe(302);
  const principal = fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(ownerEmail) as
    { id: string } | undefined;
  if (!principal) throw new Error("GitHub principal was not created");
  expect(
    fixture.db.prepare("SELECT email, source FROM identity_email_proofs WHERE principalId = ?").get(principal.id),
  ).toEqual({ email: ownerEmail, source: "github" });
});

it.each([
  ["unverified", [{ email: ownerEmail, primary: true, verified: false }]],
  ["mailbox lookup failure", null],
  ["selected address mismatch", [{ email: ownerEmail, primary: true, verified: true }]],
] as const)("does not record proof from %s", async (reason, emails) => {
  const fixture = await configured();
  const profile = reason === "selected address mismatch" ? { ...bruce, email: "other@example.test" } : bruce;
  await signInGithub(fixture, profile, emails ? [...emails] : null);
  expect(countUsers(fixture.db)).toBe(0);
  expect(fixture.db.prepare("SELECT principalId FROM identity_email_proofs").all()).toEqual([]);
});

it("keeps a returning GitHub subject stable when its verified profile address drifts", async () => {
  const fixture = await configured();
  await signInGithub(fixture, bruce, [{ email: ownerEmail, primary: true, verified: true }]);
  const id = (fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(ownerEmail) as { id: string }).id;
  await signInGithub(fixture, { ...bruce, email: "drift@example.test" }, [
    { email: "drift@example.test", primary: true, verified: true },
  ]);
  expect(countUsers(fixture.db)).toBe(1);
  expect(fixture.db.prepare("SELECT userId FROM account WHERE providerId = 'github'").get()).toEqual({ userId: id });
  expect(fixture.db.prepare("SELECT email FROM identity_email_proofs WHERE principalId = ?").get(id)).toEqual({
    email: ownerEmail,
  });
});

it("denies an original and recreated GitHub principal after Disable Access", async () => {
  const fixture = await configured();
  const owner = await signInGithub(fixture, bruce, [{ email: ownerEmail, primary: true, verified: true }]);
  const ownerCookie = readCookies(owner);
  await createCompany(fixture, ownerCookie);
  const email = "diana@example.test";
  const invitation = await fixture.app.inject({
    method: "POST",
    url: "/api/invites",
    headers: { cookie: ownerCookie },
    payload: { accountId: "a-studio", role: "editor", preauthEmail: email },
  });
  expect(invitation.statusCode, invitation.body).toBe(201);
  const token = invitation.json<{ token: string }>().token;
  const diana = { ...bruce, id: "github-diana", name: "Diana Prince", login: "diana-prince" };
  const joined = await signInGithub(fixture, diana, [{ email, primary: true, verified: true }]);
  const joinedCookie = readCookies(joined);
  const accepted = await fixture.app.inject({
    method: "POST",
    url: `/api/invites/${token}/accept`,
    headers: { cookie: joinedCookie },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const old = fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string };
  await disableMember(fixture, ownerCookie, old.id);
  expect(
    (await fixture.app.inject({ url: "/api/state?accountId=a-studio", headers: { cookie: joinedCookie } })).statusCode,
  ).toBe(403);
  expect(isAccessRestricted(fixture.db, "a-studio", old.id)).toBe(true);

  await fixture.app.inject({
    method: "DELETE",
    url: `/api/accounts/a-studio/members/${old.id}`,
    headers: { cookie: ownerCookie },
  });
  fixture.db.prepare("UPDATE user SET email = ? WHERE id = ?").run("former-diana@example.test", old.id);
  const reinvite = await fixture.app.inject({
    method: "POST",
    url: "/api/invites",
    headers: { cookie: ownerCookie },
    payload: { accountId: "a-studio", role: "viewer", preauthEmail: email },
  });
  const newToken = reinvite.json<{ token: string }>().token;
  const recreated = await signInGithub(fixture, { ...diana, id: "github-diana-recreated" }, [
    { email, primary: true, verified: true },
  ]);
  const recreatedId = (fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string }).id;
  expect(recreatedId).not.toBe(old.id);
  expect(isAccessRestricted(fixture.db, "a-studio", recreatedId)).toBe(true);
  const refused = await fixture.app.inject({
    method: "POST",
    url: `/api/invites/${newToken}/accept`,
    headers: { cookie: readCookies(recreated) },
  });
  expect(refused.statusCode, refused.body).toBe(403);
  expect(getMemberRole(fixture.db, "a-studio", recreatedId)).toBeNull();
  expect(getInvite(fixture.db, newToken)?.usedAt).toBeNull();
});

it.each(["google", "microsoft"] as const)(
  "matches retained %s proof when a new GitHub identity claims the address",
  async (source) => {
    const fixture = await configured();
    const owner = await signInGithub(fixture, bruce, [{ email: ownerEmail, primary: true, verified: true }]);
    const ownerCookie = readCookies(owner);
    await createCompany(fixture, ownerCookie);
    const now = new Date().toISOString();
    const email = `diana-${source}@example.test`;
    const former = await signUp(fixture.app, email);
    fixture.db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(former.userId);
    fixture.db
      .prepare("INSERT INTO identity_email_proofs (principalId, email, source, provenAt) VALUES (?, ?, ?, ?)")
      .run(former.userId, email, source, now);
    upsertMember(fixture.db, {
      accountId: "a-studio",
      userId: former.userId,
      role: "editor",
      status: "active",
      createdAt: now,
    });
    await disableMember(fixture, ownerCookie, former.userId);
    expect(
      fixture.db
        .prepare("SELECT verifiedEmail FROM account_access_restrictions WHERE principalId = ?")
        .get(former.userId),
    ).toEqual({ verifiedEmail: email });
    await fixture.app.inject({
      method: "DELETE",
      url: `/api/accounts/a-studio/members/${former.userId}`,
      headers: { cookie: ownerCookie },
    });
    fixture.db.prepare("UPDATE user SET email = ? WHERE id = ?").run(`former-${source}@example.test`, former.userId);
    const token = `cross-provider-${source}`;
    createInvite(fixture.db, {
      token,
      id: token,
      accountId: "a-studio",
      role: "viewer",
      preauthEmail: email,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      usedAt: null,
      createdAt: now,
    });
    const recreated = await signInGithub(fixture, { ...bruce, id: `github-diana-${source}` }, [
      { email, primary: true, verified: true },
    ]);
    const newId = (fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string }).id;
    expect(isAccessRestricted(fixture.db, "a-studio", newId)).toBe(true);
    const claim = await fixture.app.inject({
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: readCookies(recreated) },
    });
    expect(claim.statusCode, claim.body).toBe(403);
    expect(getInvite(fixture.db, token)?.usedAt).toBeNull();
  },
);
