import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createAuthFromEnvironment, runAuthMigrations } from "./auth";
import { insertRow, openDb } from "./db";
import { upsertMember } from "./controlTables";
import { PASSWORD_ENV, call, registerServerFixtureCleanup, signUp } from "./testHelpers";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
const fixtures = registerServerFixtureCleanup();
const origin = "http://localhost:8787";
const mailEnvironment = {
  SMALLSASS_ACCOUNT_MAIL_HOST: "mail.example.test",
  SMALLSASS_ACCOUNT_MAIL_PORT: "587",
  SMALLSASS_ACCOUNT_MAIL_USER: "mailer",
  SMALLSASS_ACCOUNT_MAIL_PASSWORD: "mail-secret",
  SMALLSASS_ACCOUNT_MAIL_FROM: "identity@example.test",
};
beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({});
});

async function configured() {
  const db = fixtures.trackDb(openDb(":memory:"));
  const { mode, auth } = createAuthFromEnvironment(db, { ...PASSWORD_ENV, ...mailEnvironment });
  if (!auth) throw new Error("Expected password authentication.");
  await runAuthMigrations(auth);
  const app = fixtures.trackApp(createApp(db, { authMode: mode, auth }));
  insertRow(db, "accounts", {
    id: "a1",
    name: "Wayne Enterprises",
    color: "#3b82f6",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });
  const owner = await signUp(app, "bruce@example.test");
  upsertMember(db, { accountId: "a1", userId: owner.userId, role: "owner", status: "active", createdAt: "2026-01-01" });
  return { app, db, owner };
}

function sentLink(path: string): URL {
  expect(sendMail).toHaveBeenCalledTimes(1);
  const message = sendMail.mock.calls[0]?.[0] as { text: string };
  const match = message.text.match(/http:\/\/localhost:8787\/\S+/);
  if (!match) throw new Error("Expected an email link.");
  const link = new URL(match[0]);
  expect(link.origin).toBe(origin);
  expect(link.pathname).toMatch(new RegExp(`^/${path}/`));
  expect(link.search).toBe("");
  return link;
}

describe("password reset email", () => {
  it("emails one redeemable password link and keeps unknown and provider-only responses neutral", async () => {
    const { app, db } = await configured();
    const provider = await signUp(app, "clark@example.test");
    db.prepare("UPDATE account SET providerId = 'google', password = NULL WHERE userId = ?").run(provider.userId);
    const request = (email: string) =>
      call(app, {
        method: "POST",
        url: "/api/auth/request-password-reset",
        payload: { email, redirectTo: `${origin}/ignored` },
      });
    const known = await request("bruce@example.test");
    expect(known.statusCode).toBe(200);
    const link = sentLink("reset-password");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "bruce@example.test" }));
    for (const email of ["unknown@example.test", "clark@example.test"]) {
      const response = await request(email);
      expect(response.statusCode).toBe(known.statusCode);
      expect(response.json()).toEqual(known.json());
    }
    expect(sendMail).toHaveBeenCalledTimes(1);
    const newPassword = "new-password-654321";
    const reset = await call(app, {
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token: decodeURIComponent(link.pathname.slice("/reset-password/".length)), newPassword },
    });
    expect(reset.statusCode).toBe(200);
    const login = await call(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "bruce@example.test", password: newPassword },
    });
    expect(login.statusCode).toBe(200);
    expect((await call(app, { url: "/api/auth/me" })).json()).toMatchObject({ passwordResetEmail: true });
  });

  it("admin copy-link issuance sends no email", async () => {
    const { app, db, owner } = await configured();
    const member = await signUp(app, "diana@example.test");
    upsertMember(db, {
      accountId: "a1",
      userId: member.userId,
      role: "editor",
      status: "active",
      createdAt: "2026-01-01",
    });
    const response = await call(app, {
      method: "POST",
      url: `/api/accounts/a1/members/${member.userId}/reset-password`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ token: unknown }>().token).toEqual(expect.any(String));
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("invitation email", () => {
  it("emails an addressed invitation once, including across command replay", async () => {
    const { app, owner } = await configured();
    const request = {
      method: "POST" as const,
      url: "/api/invites",
      headers: {
        cookie: owner.cookie,
        "idempotency-key": "email-invite-idempotency-01",
        "x-account-command-id": "email-invite-command-000001",
      },
      payload: { accountId: "a1", role: "editor", preauthEmail: "diana@example.test" },
    };
    const response = await call(app, request);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ emailed: true });
    expect(sentLink("invite").pathname).toBe(`/invite/${response.json<{ token: string }>().token}`);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "diana@example.test" }));
    expect((await call(app, request)).statusCode).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("preserves invitation acceptance when delivery fails", async () => {
    const { app, owner } = await configured();
    const member = await signUp(app, "diana@example.test");
    sendMail.mockRejectedValueOnce(Object.assign(new Error("private transport details"), { code: "ECONNECTION" }));
    const response = await call(app, {
      method: "POST",
      url: "/api/invites",
      headers: { cookie: owner.cookie },
      payload: { accountId: "a1", role: "editor", preauthEmail: "diana@example.test" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ emailed: false });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const token = response.json<{ token: string }>().token;
    const accepted = await call(app, {
      method: "POST",
      url: `/api/invites/${token}/accept`,
      headers: { cookie: member.cookie },
    });
    expect(accepted.statusCode).toBe(200);
  });

  it("does not email unaddressed invitations", async () => {
    const { db } = await configured();
    const app = fixtures.trackApp(createApp(db, { authMode: "off" }));
    const response = await call(app, {
      method: "POST",
      url: "/api/invites",
      payload: { accountId: "a1", role: "editor" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ emailed: false });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
