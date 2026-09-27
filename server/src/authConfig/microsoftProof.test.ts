import {
  begin,
  callback,
  claims,
  configured,
  cookieHeader,
  insertProofAccount,
  mailFailure,
  mockMicrosoftToken,
  origin,
  replaceCookies,
  requiredState,
  sentMessages,
  tenant,
} from "./microsoftProof.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inviteTokenHash } from "../controlTables/inviteTokens";
import { createApp } from "../app";
import type { Db } from "../db";
import { writeJoiningPolicy } from "../controlTables/joiningPolicies";

async function assertDisabledMicrosoftJoin(db: Db, app: ReturnType<typeof createApp>, cookie: string): Promise<void> {
  const joinedPrincipal = db.prepare("SELECT id FROM user WHERE email = 'diana@example.com'").get() as { id: string };
  db.prepare(
    `INSERT INTO account_access_restrictions (accountId, principalId, verifiedEmail, role, createdAt)
     VALUES ('a-studio', ?, 'diana@example.com', 'viewer', ?)`,
  ).run(joinedPrincipal.id, new Date().toISOString());
  const denied = await app.inject({
    method: "POST",
    url: "/api/company-join/complete-microsoft",
    headers: { cookie },
    payload: {},
  });
  expect(denied.statusCode).toBe(403);
  expect(
    db.prepare("SELECT 1 FROM account_members WHERE accountId = 'a-studio' AND userId = ?").get(joinedPrincipal.id),
  ).toBeUndefined();
  db.prepare("DELETE FROM account_access_restrictions WHERE accountId = 'a-studio' AND principalId = ?").run(
    joinedPrincipal.id,
  );
}

// eslint-disable-next-line max-lines-per-function -- The native callback cases share one controlled provider and SMTP harness.
describe("Microsoft native callback proof", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sentMessages.length = 0;
    mailFailure.enabled = false;
  });

  it("matches approved Microsoft join domains through the canonical SQL gate", async () => {
    const { db } = await configured();
    try {
      const matches = db.prepare("SELECT capacitylens_approved_domain_matches(?, ?) AS allowed");
      expect(matches.get("diana@bücher.example", '["xn--bcher-kva.example"]')).toEqual({ allowed: 1 });
      expect(matches.get("diana@xn--bcher-kva.example", '["xn--bcher-kva.example"]')).toEqual({ allowed: 1 });
      expect(matches.get("diana@staff.bücher.example", '["xn--bcher-kva.example"]')).toEqual({ allowed: 0 });
    } finally {
      db.close();
    }
  });

  it("binds a verified bootstrap account through native code flow and consumes the exact approval", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken({
        iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
        aud: "microsoft-client",
        exp: Math.floor(Date.now() / 1000) + 600,
        tid: tenant,
        oid: "stable-object-id",
        sub: "other-subject",
        email: "bruce@example.com",
        email_verified: true,
        name: "Bruce Wayne",
      });
      const result = await callback(auth, started.state, started.cookies);
      expect(result.status).toBe(302);
      expect(result.headers.get("location")).toBe(`${origin}/`);
      expect(db.prepare("SELECT accountId, providerId FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        accountId: "stable-object-id",
        providerId: "microsoft",
      });
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "completed" });
      expect(db.prepare("SELECT email, source FROM identity_email_proofs").get()).toEqual({
        email: "bruce@example.com",
        source: "microsoft",
      });
      const auditedConnections = db
        .prepare(
          `SELECT observation.providerId, observation.subject
           FROM capacitylens_federated_link_observations AS observation
           JOIN capacitylens_audit_outbox AS audit ON audit.id = 'identity-link:' || observation.accountRowId
          WHERE observation.auditedAt IS NOT NULL`,
        )
        .all();
      expect(auditedConnections).toEqual([{ providerId: "microsoft", subject: "stable-object-id" }]);
    } finally {
      db.close();
    }
  });

  it("uses the stored proven mailbox for an established Microsoft identity without a new proof", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      await callback(auth, started.state, started.cookies);
      const returning = await auth.handler(
        new Request(`${origin}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "microsoft", callbackURL: `${origin}/`, errorCallbackURL: `${origin}/` }),
        }),
      );
      expect(returning.status).toBe(200);
      const next = (await returning.json()) as { url: string };
      mockMicrosoftToken(claims());
      const result = await callback(auth, requiredState(next.url), cookieHeader(returning.headers.getSetCookie()));
      expect(result.status).toBe(302);
      expect(db.prepare("SELECT email FROM user").all()).toEqual([{ email: "bruce@example.com" }]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        count: 1,
      });
    } finally {
      db.close();
    }
  });

  it("joins an open company through a verified Microsoft callback and explicit completion", async () => {
    const { db, auth } = await configured();
    const app = createApp(db, {
      authMode: "sso-only",
      auth,
      joiningProof: {
        secret: "unit-test-secret-0123456789abcdef-0123",
        publicUrl: new URL(origin),
      },
    });
    try {
      db.prepare(
        `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt)
        VALUES ('existing','Clark Kent','clark@example.com',1,?,?)`,
      ).run(Date.now(), Date.now());
      insertProofAccount(db, "a-studio");
      writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "join",
          accountId: "a-studio",
          email: "diana@example.com",
          callbackURL: `${origin}/join/a-studio`,
          errorCallbackURL: `${origin}/join/a-studio`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      const cookies = cookieHeader(started.setCookies);
      mockMicrosoftToken({ ...claims("diana@example.com"), oid: "diana-oid", name: "Diana Prince" });
      const callbackResult = await callback(auth, requiredState(started.url), cookies);
      expect(callbackResult.status).toBe(302);
      expect(callbackResult.headers.get("location")).toBe(`${origin}/join/a-studio`);
      expect(
        db.prepare("SELECT source,email FROM identity_email_proofs WHERE email = 'diana@example.com'").get(),
      ).toEqual({ source: "microsoft", email: "diana@example.com" });
      expect(
        db.prepare("SELECT 1 FROM account_members WHERE accountId = 'a-studio' AND userId <> 'existing'").get(),
      ).toBeUndefined();
      const callbackCookies = replaceCookies(cookies, callbackResult.headers.getSetCookie());
      await assertDisabledMicrosoftJoin(db, app, callbackCookies);
      const completed = await app.inject({
        method: "POST",
        url: "/api/company-join/complete-microsoft",
        headers: { cookie: callbackCookies },
        payload: {},
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json()).toMatchObject({ accountId: "a-studio", role: "viewer" });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("creates no Microsoft identity before its same-browser company mailbox proof", async () => {
    const { db, auth } = await configured();
    try {
      db.prepare(
        `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt)
        VALUES ('existing','Clark Kent','clark@example.com',1,?,?)`,
      ).run(Date.now(), Date.now());
      insertProofAccount(db, "a-studio");
      writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "join",
          accountId: "a-studio",
          email: "diana@example.com",
          callbackURL: `${origin}/join/a-studio`,
          errorCallbackURL: `${origin}/join/a-studio`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      const cookies = cookieHeader(started.setCookies);
      mockMicrosoftToken({ ...claims(), oid: "diana-oid", name: "Diana Prince" });
      const pending = await callback(auth, requiredState(started.url), cookies);
      expect(pending.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      expect(db.prepare("SELECT id FROM user WHERE email = 'diana@example.com'").get()).toBeUndefined();
      expect(db.prepare("SELECT id FROM account WHERE accountId = 'diana-oid'").get()).toBeUndefined();
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      await expect(auth.microsoftProof.confirm(new Headers(), token)).rejects.toMatchObject({ status: 410 });
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: cookies }), token);
      mockMicrosoftToken({ ...claims(), oid: "diana-oid", name: "Diana Prince" });
      const signedIn = await callback(auth, requiredState(resumed.url), replaceCookies(cookies, resumed.setCookies));
      expect(signedIn.headers.get("location")).toBe(`${origin}/join/a-studio`);
      expect(db.prepare("SELECT email FROM user WHERE email = 'diana@example.com'").get()).toEqual({
        email: "diana@example.com",
      });
    } finally {
      db.close();
    }
  });

  it("retains Microsoft join start limits across replacement in one browser", async () => {
    const { db, auth } = await configured();
    try {
      insertProofAccount(db, "a-studio");
      writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
      let cookies = "";
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const started = await auth.microsoftProof.start({
          body: {
            purpose: "join",
            accountId: "a-studio",
            email: `diana${attempt}@example.com`,
            callbackURL: `${origin}/join/a-studio`,
            errorCallbackURL: `${origin}/join/a-studio`,
          },
          headers: new Headers({ cookie: cookies }),
          sourceIp: `127.0.0.${attempt + 1}`,
        });
        cookies = replaceCookies(cookies, started.setCookies);
      }
      await expect(
        auth.microsoftProof.start({
          body: {
            purpose: "join",
            accountId: "a-studio",
            email: "diana10@example.com",
            callbackURL: `${origin}/join/a-studio`,
            errorCallbackURL: `${origin}/join/a-studio`,
          },
          headers: new Headers({ cookie: cookies }),
          sourceIp: "127.0.1.10",
        }),
      ).rejects.toMatchObject({ status: 429 });
      expect(auth.microsoftProof.status(new Headers({ cookie: cookies })).state).toBe("pending");
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM microsoft_identity_proofs WHERE purpose = 'join'").get(),
      ).toEqual({ count: 10 });
    } finally {
      db.close();
    }
  });

  it("rejects a Microsoft callback when the company's joining policy changes before identity creation", async () => {
    const { db, auth } = await configured();
    try {
      db.prepare(
        `INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt)
        VALUES ('existing','Clark Kent','clark@example.com',1,?,?)`,
      ).run(Date.now(), Date.now());
      insertProofAccount(db, "a-studio");
      writeJoiningPolicy(db, "a-studio", { policy: "open", approvedDomains: [] });
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "join",
          accountId: "a-studio",
          email: "diana@example.com",
          callbackURL: `${origin}/join/a-studio`,
          errorCallbackURL: `${origin}/join/a-studio`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      writeJoiningPolicy(db, "a-studio", { policy: "invitation_only", approvedDomains: [] });
      mockMicrosoftToken({ ...claims("diana@example.com"), oid: "diana-oid", name: "Diana Prince" });
      const rejected = await callback(auth, requiredState(started.url), cookieHeader(started.setCookies));
      expect(rejected.headers.get("location")).toContain("error=MICROSOFT_JOIN_UNAVAILABLE");
      expect(db.prepare("SELECT id FROM user WHERE email = 'diana@example.com'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("reuses a returning stable Microsoft identity's durable mailbox proof for a second company", async () => {
    const { db, auth } = await configured();
    const app = createApp(db, {
      authMode: "sso-only",
      auth,
      joiningProof: {
        secret: "unit-test-secret-0123456789abcdef-0123",
        publicUrl: new URL(origin),
      },
    });
    try {
      const bootstrap = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      await callback(auth, bootstrap.state, bootstrap.cookies);
      insertProofAccount(db, "a-loft");
      writeJoiningPolicy(db, "a-loft", { policy: "open", approvedDomains: [] });
      db.prepare(
        "UPDATE microsoft_identity_proofs SET state = 'approved', expiresAt = ? WHERE purpose = 'bootstrap'",
      ).run(Date.now() - 1);
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "join",
          accountId: "a-loft",
          email: "bruce@example.com",
          callbackURL: `${origin}/join/a-loft`,
          errorCallbackURL: `${origin}/join/a-loft`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.2",
      });
      const cookies = cookieHeader(started.setCookies);
      mockMicrosoftToken(claims());
      const signedIn = await callback(auth, requiredState(started.url), cookies);
      expect(signedIn.headers.get("location")).toBe(`${origin}/join/a-loft`);
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs WHERE purpose = 'bootstrap'").get()).toEqual({
        state: "cancelled",
      });
      expect(sentMessages).toHaveLength(0);
      const completed = await app.inject({
        method: "POST",
        url: "/api/company-join/complete-microsoft",
        headers: { cookie: replaceCookies(cookies, signedIn.headers.getSetCookie()) },
        payload: {},
      });
      expect(completed.statusCode, completed.body).toBe(200);
      expect(completed.json()).toMatchObject({ accountId: "a-loft", role: "viewer" });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("cancels callback-complete Microsoft joining before membership completion", async () => {
    const { db, auth } = await configured();
    try {
      const bootstrap = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      await callback(auth, bootstrap.state, bootstrap.cookies);
      insertProofAccount(db, "a-loft");
      writeJoiningPolicy(db, "a-loft", { policy: "open", approvedDomains: [] });
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "join",
          accountId: "a-loft",
          email: "bruce@example.com",
          callbackURL: `${origin}/join/a-loft`,
          errorCallbackURL: `${origin}/join/a-loft`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.2",
      });
      const cookies = cookieHeader(started.setCookies);
      mockMicrosoftToken(claims());
      const signedIn = await callback(auth, requiredState(started.url), cookies);
      const callbackCookies = replaceCookies(cookies, signedIn.headers.getSetCookie());
      expect(auth.microsoftProof.status(new Headers({ cookie: callbackCookies })).state).toBe("approved");
      auth.microsoftProof.cancel(new Headers({ cookie: callbackCookies }));
      expect(auth.microsoftProof.status(new Headers({ cookie: callbackCookies })).state).toBe("expired");
      expect(db.prepare("SELECT 1 FROM account_members WHERE accountId = 'a-loft'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("requires a mailbox ceremony when a returning Microsoft identity has no durable address proof", async () => {
    const { db, auth } = await configured();
    try {
      const bootstrap = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      await callback(auth, bootstrap.state, bootstrap.cookies);
      db.prepare("DELETE FROM identity_email_proofs WHERE email = 'bruce@example.com'").run();
      insertProofAccount(db, "a-loft");
      writeJoiningPolicy(db, "a-loft", { policy: "open", approvedDomains: [] });
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "join",
          accountId: "a-loft",
          email: "bruce@example.com",
          callbackURL: `${origin}/join/a-loft`,
          errorCallbackURL: `${origin}/join/a-loft`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.2",
      });
      const cookies = cookieHeader(started.setCookies);
      mockMicrosoftToken(claims("bruce@example.com"));
      const pending = await callback(auth, requiredState(started.url), cookies);
      expect(pending.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      expect(sentMessages).toHaveLength(1);
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: cookies }), token);
      mockMicrosoftToken(claims());
      const signedIn = await callback(auth, requiredState(resumed.url), replaceCookies(cookies, resumed.setCookies));
      expect(signedIn.headers.get("location")).toBe(`${origin}/join/a-loft`);
      expect(
        db.prepare("SELECT source,email FROM identity_email_proofs WHERE email = 'bruce@example.com'").get(),
      ).toEqual({ source: "microsoft", email: "bruce@example.com" });
    } finally {
      db.close();
    }
  });

  // eslint-disable-next-line max-lines-per-function -- One callback carries the same invitation through domain-only denial and permitted acceptance.
  it("accepts a returning Microsoft identity's addressed invitation without minting durable proof", async () => {
    const { db, auth } = await configured();
    const app = createApp(db, { authMode: "sso-only", auth });
    try {
      const initial = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      await callback(auth, initial.state, initial.cookies);
      db.prepare("DELETE FROM identity_email_proofs WHERE email = 'bruce@example.com'").run();
      insertProofAccount(db, "a-loft");
      writeJoiningPolicy(db, "a-loft", { policy: "approved_domains", approvedDomains: ["example.com"] });
      const inviteToken = "second-workspace-invite";
      db.prepare(
        `INSERT INTO invites (tokenHash,id,accountId,role,preauthEmail,expiresAt,usedAt,createdAt)
        VALUES (?,?,?,?,?,?,NULL,?)`,
      ).run(
        inviteTokenHash(inviteToken),
        "invite-new-workspace",
        "a-loft",
        "editor",
        "bruce@example.com",
        new Date(Date.now() + 600_000).toISOString(),
        new Date().toISOString(),
      );
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "invite",
          inviteToken,
          callbackURL: `${origin}/invite/${inviteToken}`,
          errorCallbackURL: `${origin}/invite/${inviteToken}`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      mockMicrosoftToken(claims());
      const signedIn = await callback(auth, requiredState(started.url), cookieHeader(started.setCookies));
      expect(signedIn.status).toBe(302);
      expect(signedIn.headers.get("location")).toBe(`${origin}/invite/${inviteToken}`);
      expect(
        signedIn.headers
          .getSetCookie()
          .map((value) => value.split("=", 1)[0])
          .some((name) => name?.endsWith("session_token")),
      ).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        count: 1,
      });
      const headers = { cookie: cookieHeader(signedIn.headers.getSetCookie()) };
      const domainOnly = await app.inject({
        method: "POST",
        url: `/api/invites/${inviteToken}/accept`,
        headers,
        payload: {},
      });
      expect(domainOnly.statusCode).toBe(403);
      expect(db.prepare("SELECT 1 FROM account_members WHERE accountId = 'a-loft'").get()).toBeUndefined();
      writeJoiningPolicy(db, "a-loft", { policy: "invitation_only", approvedDomains: [] });
      const accepted = await app.inject({
        method: "POST",
        url: `/api/invites/${inviteToken}/accept`,
        headers,
        payload: {},
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({ accountId: "a-loft", role: "editor" });
      expect(db.prepare("SELECT role FROM account_members WHERE accountId = 'a-loft'").get()).toEqual({
        role: "editor",
      });
      expect(db.prepare("SELECT 1 FROM identity_email_proofs WHERE email = 'bruce@example.com'").get()).toBeUndefined();
    } finally {
      await app.close();
      db.close();
    }
  });

  // eslint-disable-next-line max-lines-per-function -- The new-principal case checks encrypted return storage and native membership acceptance.
  it("accepts an addressed invitation after a new Microsoft principal proves its mailbox", async () => {
    const { db, auth } = await configured();
    const app = createApp(db, { authMode: "sso-only", auth });
    try {
      insertProofAccount(db, "a-studio");
      const inviteToken = "new-microsoft-invite";
      db.prepare(
        `INSERT INTO invites (tokenHash,id,accountId,role,preauthEmail,expiresAt,usedAt,createdAt)
        VALUES (?,?,?,?,?,?,NULL,?)`,
      ).run(
        inviteTokenHash(inviteToken),
        "new-microsoft-invite-id",
        "a-studio",
        "editor",
        "bruce@example.com",
        new Date(Date.now() + 600_000).toISOString(),
        new Date().toISOString(),
      );
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "invite",
          inviteToken,
          callbackURL: `${origin}/invite/${inviteToken}`,
          errorCallbackURL: `${origin}/invite/${inviteToken}`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      const cookies = cookieHeader(started.setCookies);
      const proof = db.prepare("SELECT callbackUrl, errorCallbackUrl FROM microsoft_identity_proofs").get() as {
        callbackUrl: string;
        errorCallbackUrl: string;
      };
      expect(JSON.stringify(proof)).not.toContain(inviteToken);
      expect(
        (db.prepare("SELECT value FROM verification").all() as Array<{ value: string }>).every(
          (row) => !row.value.includes(inviteToken),
        ),
      ).toBe(true);
      mockMicrosoftToken(claims());
      const pending = await callback(auth, requiredState(started.url), cookies);
      expect(pending.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: cookies }), token);
      expect(
        (db.prepare("SELECT value FROM verification").all() as Array<{ value: string }>).every(
          (row) => !row.value.includes(inviteToken),
        ),
      ).toBe(true);
      const signedIn = await callback(auth, requiredState(resumed.url), replaceCookies(cookies, resumed.setCookies));
      expect(signedIn.status).toBe(302);
      expect(signedIn.headers.get("location")).toBe(`${origin}/invite/${inviteToken}`);
      const accepted = await app.inject({
        method: "POST",
        url: `/api/invites/${inviteToken}/accept`,
        headers: { cookie: cookieHeader(signedIn.headers.getSetCookie()) },
        payload: {},
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({ accountId: "a-studio", role: "editor" });
      expect(db.prepare("SELECT role FROM account_members WHERE accountId = 'a-studio'").get()).toEqual({
        role: "editor",
      });
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "completed" });
    } finally {
      await app.close();
      db.close();
    }
  });
});
