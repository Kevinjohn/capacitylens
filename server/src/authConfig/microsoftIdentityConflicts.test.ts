import {
  configured,
  begin,
  callback,
  claims,
  mockMicrosoftToken,
  cookieHeader,
  requiredState,
  replaceCookies,
  origin,
} from "./microsoftProof.testSupport";
import { afterEach, expect, it, vi } from "vitest";
import { insertRow } from "../db";
import { createInvite, getInvite } from "../controlTables";

type Fixture = Awaited<ReturnType<typeof configured>>;

afterEach(() => vi.unstubAllGlobals());

async function nativeSignIn(fixture: Fixture, profile: Record<string, unknown>) {
  const started = await fixture.auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "microsoft", callbackURL: `${origin}/`, errorCallbackURL: `${origin}/` }),
    }),
  );
  expect(started.status).toBe(200);
  const body = (await started.json()) as { url: string };
  mockMicrosoftToken(profile);
  return callback(fixture.auth, requiredState(body.url), cookieHeader(started.headers.getSetCookie()));
}

async function createLocal(fixture: Fixture, email: string, name: string) {
  await fixture.auth.createCredentialUser({ email, name, password: "password-123456", emailVerified: true });
  const principal = fixture.db.prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string };
  const signedIn = await fixture.auth.handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password-123456" }),
    }),
  );
  expect(signedIn.status).toBe(200);
  return { id: principal.id, cookie: cookieHeader(signedIn.headers.getSetCookie()) };
}

it("keeps the stored proven mailbox when returning Microsoft claims change", async () => {
  const fixture = await configured();
  try {
    const started = await begin(fixture.auth);
    mockMicrosoftToken(claims("bruce@example.com"));
    expect((await callback(fixture.auth, started.state, started.cookies)).status).toBe(302);
    const before = fixture.db.prepare("SELECT id, email FROM user").all();
    const returned = await nativeSignIn(fixture, claims("changed@example.com"));
    expect(returned.status).toBe(302);
    expect(returned.headers.get("location")).toBe(`${origin}/`);
    expect(fixture.db.prepare("SELECT id, email FROM user").all()).toEqual(before);
    expect(fixture.db.prepare("SELECT accountId FROM account WHERE providerId = 'microsoft'").all()).toEqual([
      { accountId: "stable-object-id" },
    ]);
  } finally {
    fixture.db.close();
  }
});

it("refuses to attach an established Microsoft identity to a different local principal", async () => {
  const fixture = await configured("password");
  try {
    const first = await begin(fixture.auth);
    mockMicrosoftToken(claims("bruce@example.com"));
    expect((await callback(fixture.auth, first.state, first.cookies)).status).toBe(302);
    const original = fixture.db.prepare("SELECT userId, accountId FROM account WHERE providerId = 'microsoft'").all();
    const diana = await createLocal(fixture, "diana@example.com", "Diana Prince");
    const started = await fixture.auth.microsoftProof.start({
      body: { purpose: "link", callbackURL: `${origin}/account`, errorCallbackURL: `${origin}/account` },
      headers: new Headers({ cookie: diana.cookie }),
      sourceIp: "192.0.2.1",
    });
    mockMicrosoftToken(claims("diana@example.com"));
    const rejected = await callback(
      fixture.auth,
      requiredState(started.url),
      replaceCookies(diana.cookie, started.setCookies),
    );
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toContain("MICROSOFT_IDENTITY_ALREADY_LINKED");
    expect(fixture.db.prepare("SELECT userId, accountId FROM account WHERE providerId = 'microsoft'").all()).toEqual(
      original,
    );
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 2 });
    expect(
      fixture.db.prepare("SELECT id FROM account WHERE providerId = 'microsoft' AND userId = ?").all(diana.id),
    ).toEqual([]);
  } finally {
    fixture.db.close();
  }
});

it("does not implicitly merge a Microsoft invitation identity into a matching password account", async () => {
  const fixture = await configured("password");
  try {
    const local = await createLocal(fixture, "bruce@example.com", "Bruce Wayne");
    const now = new Date().toISOString();
    insertRow(fixture.db, "accounts", {
      id: "a-studio",
      name: "Wayne Enterprises",
      color: "#6366f1",
      createdAt: now,
      updatedAt: now,
    });
    const token = "microsoft-email-collision-invite";
    createInvite(fixture.db, {
      token,
      id: "collision-invite",
      accountId: "a-studio",
      role: "editor",
      preauthEmail: "bruce@example.com",
      createdAt: now,
      usedAt: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const started = await fixture.auth.microsoftProof.start({
      body: {
        purpose: "invite",
        inviteToken: token,
        callbackURL: `${origin}/invite/${token}`,
        errorCallbackURL: `${origin}/invite/${token}`,
      },
      headers: new Headers(),
      sourceIp: "192.0.2.1",
    });
    mockMicrosoftToken(claims("bruce@example.com"));
    const rejected = await callback(fixture.auth, requiredState(started.url), cookieHeader(started.setCookies));
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toBe(`${origin}/invite/${token}?error=account_not_linked`);
    expect(fixture.db.prepare("SELECT id FROM user").all()).toEqual([{ id: local.id }]);
    expect(fixture.db.prepare("SELECT id FROM account WHERE providerId = 'microsoft'").all()).toEqual([]);
    expect(fixture.db.prepare("SELECT accountId FROM account_members WHERE userId = ?").all(local.id)).toEqual([]);
    expect(getInvite(fixture.db, token)?.usedAt).toBeNull();
  } finally {
    fixture.db.close();
  }
});
