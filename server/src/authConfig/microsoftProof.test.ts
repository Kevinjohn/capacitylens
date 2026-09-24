import {
  begin,
  callback,
  claims,
  configured,
  cookieHeader,
  mailFailure,
  mockMicrosoftToken,
  origin,
  replaceCookies,
  requiredState,
  sentMessages,
  tenant,
} from "./microsoftProof.testSupport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertRow } from "../db";
import { inviteTokenHash } from "../controlTables/inviteTokens";
import { microsoftCallbackCapture } from "./captureContexts";
import { createApp } from "../app";

// eslint-disable-next-line max-lines-per-function -- The native callback cases share one controlled provider and SMTP harness.
describe("Microsoft native callback proof", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sentMessages.length = 0;
    mailFailure.enabled = false;
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

  // eslint-disable-next-line max-lines-per-function -- The established invitation case covers native return and membership acceptance together.
  it("lets an established Microsoft principal accept a new workspace invitation without rebinding", async () => {
    const { db, auth } = await configured();
    const app = createApp(db, { authMode: "sso", auth });
    try {
      const initial = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      await callback(auth, initial.state, initial.cookies);
      insertRow(db, "accounts", {
        id: "a-loft",
        name: "Stark Industries",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
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
      const accepted = await app.inject({
        method: "POST",
        url: `/api/invites/${inviteToken}/accept`,
        headers: { cookie: cookieHeader(signedIn.headers.getSetCookie()) },
        payload: {},
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ accountId: "a-loft", role: "editor" });
    } finally {
      await app.close();
      db.close();
    }
  });

  // eslint-disable-next-line max-lines-per-function -- The new-principal case checks encrypted return storage and native membership acceptance.
  it("binds a new invited Microsoft principal and accepts the same invitation into its workspace", async () => {
    const { db, auth } = await configured();
    const app = createApp(db, { authMode: "sso", auth });
    try {
      insertRow(db, "accounts", {
        id: "a-studio",
        name: "Wayne Enterprises",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
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
      expect(accepted.json()).toMatchObject({ accountId: "a-studio", role: "editor" });
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "completed" });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("sends mailbox proof and redirects the first native callback before creating a principal", async () => {
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
        name: "Bruce Wayne",
      });
      const result = await callback(auth, started.state, started.cookies);
      expect(result.status).toBe(302);
      expect(result.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.to).toBe("bruce@example.com");
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT state, oid FROM microsoft_identity_proofs").get()).toEqual({
        state: "mail-sent",
        oid: "stable-object-id",
      });
    } finally {
      db.close();
    }
  });

  it("requires the same browser to confirm, resumes with a new OAuth state, and refuses replay after binding", async () => {
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
        name: "Bruce Wayne",
      });
      await callback(auth, started.state, started.cookies);
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      await expect(auth.microsoftProof.confirm(new Headers(), token)).rejects.toMatchObject({ status: 410 });
      const headers = new Headers({ cookie: started.cookies });
      const resumed = await auth.microsoftProof.confirm(headers, token);
      expect(auth.microsoftProof.status(headers).state).toBe("approved");
      const afterReload = await auth.microsoftProof.confirm(headers);
      const oldState = new URL(resumed.url).searchParams.get("state");
      const newState = new URL(afterReload.url).searchParams.get("state");
      expect(oldState).toBeTruthy();
      expect(newState).toBeTruthy();
      const stale = await callback(auth, requiredState(resumed.url), started.cookies);
      expect(stale.headers.get("location")).toContain("MICROSOFT_PROOF_CALLBACK_MISMATCH");
      const completed = await callback(
        auth,
        requiredState(afterReload.url),
        replaceCookies(started.cookies, afterReload.setCookies),
      );
      expect(completed.status).toBe(302);
      expect(db.prepare("SELECT email FROM user").get()).toEqual({ email: "bruce@example.com" });
      expect(db.prepare("SELECT state, tokenHash FROM microsoft_identity_proofs").get()).toEqual({
        state: "completed",
        tokenHash: null,
      });
      await expect(auth.microsoftProof.confirm(headers, token)).rejects.toMatchObject({ status: 410 });
    } finally {
      db.close();
    }
  });

  // eslint-disable-next-line max-lines-per-function -- The same invitation fixture checks callback and insert-time revocation.
  it("binds an invited mailbox and refuses the second callback after the invitation is consumed elsewhere", async () => {
    const { db, auth } = await configured();
    try {
      db.prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('existing','Clark Kent','clark@example.com',1,?,?)",
      ).run(Date.now(), Date.now());
      insertRow(db, "accounts", {
        id: "a-studio",
        name: "Wayne Enterprises",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const token = "controlled-invite-token";
      db.prepare(
        `INSERT INTO invites (tokenHash,id,accountId,role,preauthEmail,expiresAt,usedAt,createdAt)
        VALUES (?,?,?,?,?,?,NULL,?)`,
      ).run(
        inviteTokenHash(token),
        "invite-1",
        "a-studio",
        "editor",
        "bruce@example.com",
        new Date(Date.now() + 600_000).toISOString(),
        new Date().toISOString(),
      );
      const started = await auth.microsoftProof.start({
        body: {
          purpose: "invite",
          inviteToken: token,
          callbackURL: `${origin}/invite/${token}`,
          errorCallbackURL: `${origin}/invite/${token}`,
        },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      const state = requiredState(started.url);
      const cookies = cookieHeader(started.setCookies);
      const storedProof = db.prepare("SELECT callbackUrl, errorCallbackUrl FROM microsoft_identity_proofs").get() as {
        callbackUrl: string;
        errorCallbackUrl: string;
      };
      expect(JSON.stringify(storedProof)).not.toContain(token);
      const storedState = db.prepare("SELECT value FROM verification").all() as Array<{ value: string }>;
      expect(storedState.length).toBeGreaterThan(0);
      expect(storedState.every((row) => !row.value.includes(token))).toBe(true);
      mockMicrosoftToken(claims());
      const pending = await callback(auth, state, cookies);
      expect(pending.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      const mailToken = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: cookies }), mailToken);
      const resumedState = db.prepare("SELECT value FROM verification").all() as Array<{ value: string }>;
      expect(resumedState.every((row) => !row.value.includes(token))).toBe(true);
      db.prepare("UPDATE invites SET usedAt = ? WHERE id = 'invite-1'").run(new Date().toISOString());
      const rejected = await callback(auth, requiredState(resumed.url), replaceCookies(cookies, resumed.setCookies));
      expect(rejected.status).toBe(302);
      expect(rejected.headers.get("location")).toBe(`${origin}/invite/${token}?error=MICROSOFT_INVITE_EXPIRED`);
      expect(db.prepare("SELECT id FROM account WHERE providerId = 'microsoft'").get()).toBeUndefined();
      db.prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('target','Bruce Wayne','bruce@example.com',1,?,?)",
      ).run(Date.now(), Date.now());
      const proof = db.prepare("SELECT id FROM microsoft_identity_proofs").get() as { id: string };
      const attempt = () =>
        microsoftCallbackCapture.run(
          {
            request: new Request(origin),
            proofId: proof.id,
            bootstrapClaimToken: null,
            pending: false,
          },
          () =>
            db
              .prepare(
                `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
        VALUES ('denied','microsoft','stable-object-id','target',?,?)`,
              )
              .run(Date.now(), Date.now()),
        );
      expect(attempt).toThrow("microsoft_proof_required");
      expect(db.prepare("SELECT id FROM account WHERE providerId = 'microsoft'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("rolls back a provisional native principal when the invitation is revoked at account insertion", async () => {
    const { db, auth } = await configured();
    try {
      insertRow(db, "accounts", {
        id: "a-studio",
        name: "Wayne Enterprises",
        color: "#6366f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const inviteToken = "race-invite-token";
      db.prepare(
        `INSERT INTO invites (tokenHash,id,accountId,role,preauthEmail,expiresAt,usedAt,createdAt)
        VALUES (?,?,?,?,?,?,NULL,?)`,
      ).run(
        inviteTokenHash(inviteToken),
        "race-invite",
        "a-studio",
        "editor",
        "bruce@example.com",
        new Date(Date.now() + 600_000).toISOString(),
        new Date().toISOString(),
      );
      const started = await auth.microsoftProof.start({
        body: { purpose: "invite", inviteToken, callbackURL: `${origin}/`, errorCallbackURL: `${origin}/` },
        headers: new Headers(),
        sourceIp: "127.0.0.1",
      });
      const cookies = cookieHeader(started.setCookies);
      mockMicrosoftToken(claims());
      await callback(auth, requiredState(started.url), cookies);
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: cookies }), token);
      db.exec(`CREATE TEMP TRIGGER revoke_invite_during_account_insert BEFORE INSERT ON account
        WHEN NEW.providerId = 'microsoft' BEGIN
          UPDATE invites SET usedAt = '2026-01-01T00:00:00.000Z' WHERE id = 'race-invite';
        END`);
      const rejected = await callback(auth, requiredState(resumed.url), replaceCookies(cookies, resumed.setCookies));
      expect(rejected.status).toBe(302);
      expect(rejected.headers.get("location")).toContain("error=");
      expect(db.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        count: 0,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  // eslint-disable-next-line max-lines-per-function -- The live session row check runs between approval and the native callback.
  it("connects Microsoft to the same fresh password principal after mailbox proof", async () => {
    const { db, auth } = await configured("password");
    try {
      const principal = await auth.createCredentialUser({
        email: "bruce@example.com",
        name: "Bruce Wayne",
        password: "correct-horse-battery-staple",
        emailVerified: true,
      });
      const signedIn = await auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "bruce@example.com", password: "correct-horse-battery-staple" }),
        }),
      );
      expect(signedIn.status).toBe(200);
      const cookies = cookieHeader(signedIn.headers.getSetCookie());
      const start = await auth.microsoftProof.start({
        body: { purpose: "link", callbackURL: `${origin}/`, errorCallbackURL: `${origin}/` },
        headers: new Headers({ cookie: cookies }),
        sourceIp: "127.0.0.1",
      });
      const browserCookies = replaceCookies(cookies, start.setCookies);
      mockMicrosoftToken(claims());
      const first = await callback(auth, requiredState(start.url), browserCookies);
      expect(first.headers.get("location")).toContain("/verify-microsoft?state=check-email");
      const mailToken = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: browserCookies }), mailToken);
      const liveSession = db.prepare("SELECT id, expiresAt FROM session WHERE userId = ?").get(principal.id) as {
        id: string;
        expiresAt: string;
      };
      db.prepare("UPDATE session SET expiresAt = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", liveSession.id);
      const proof = db.prepare("SELECT id FROM microsoft_identity_proofs").get() as { id: string };
      const expiredInsert = () =>
        microsoftCallbackCapture.run(
          {
            request: new Request(origin),
            proofId: proof.id,
            bootstrapClaimToken: null,
            pending: false,
          },
          () =>
            db
              .prepare(
                `INSERT INTO account (id, providerId, accountId, userId, createdAt, updatedAt)
        VALUES ('expired-link','microsoft','stable-object-id',?,?,?)`,
              )
              .run(principal.id, Date.now(), Date.now()),
        );
      expect(expiredInsert).toThrow("microsoft_proof_required");
      db.prepare("UPDATE session SET expiresAt = ? WHERE id = ?").run(liveSession.expiresAt, liveSession.id);
      const second = await callback(
        auth,
        requiredState(resumed.url),
        replaceCookies(browserCookies, resumed.setCookies),
      );
      expect(second.status).toBe(302);
      expect(db.prepare("SELECT userId, accountId FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        userId: principal.id,
        accountId: "stable-object-id",
      });
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "completed" });
      db.prepare("DELETE FROM account WHERE providerId = 'microsoft' AND userId = ?").run(principal.id);
      await expect(
        auth.microsoftProof.confirm(new Headers({ cookie: browserCookies }), mailToken),
      ).rejects.toMatchObject({
        status: 410,
      });
      await callback(auth, requiredState(resumed.url), replaceCookies(browserCookies, resumed.setCookies));
      expect(db.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
    }
  });

  it("invalidates an approved link when its authenticated session signs out", async () => {
    const { db, auth } = await configured("password");
    try {
      await auth.createCredentialUser({
        email: "bruce@example.com",
        name: "Bruce Wayne",
        password: "correct-horse-battery-staple",
        emailVerified: true,
      });
      const signedIn = await auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "bruce@example.com", password: "correct-horse-battery-staple" }),
        }),
      );
      const cookies = cookieHeader(signedIn.headers.getSetCookie());
      const start = await auth.microsoftProof.start({
        body: { purpose: "link", callbackURL: `${origin}/`, errorCallbackURL: `${origin}/` },
        headers: new Headers({ cookie: cookies }),
        sourceIp: "127.0.0.1",
      });
      const browserCookies = replaceCookies(cookies, start.setCookies);
      mockMicrosoftToken(claims());
      await callback(auth, requiredState(start.url), browserCookies);
      const mailToken = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: browserCookies }), mailToken);
      const signedOut = await auth.handler(
        new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: { cookie: cookies } }),
      );
      expect(signedOut.status).toBe(200);
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "cancelled" });
      await expect(auth.microsoftProof.confirm(new Headers({ cookie: browserCookies }))).rejects.toMatchObject({
        status: 410,
      });
      const late = await callback(auth, requiredState(resumed.url), replaceCookies(browserCookies, resumed.setCookies));
      expect(late.headers.get("location")).toContain("MICROSOFT_PROOF_CALLBACK_MISMATCH");
      expect(db.prepare("SELECT id FROM account WHERE providerId = 'microsoft'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("throttles resend and invalidates the replaced mailbox token", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken(claims());
      await callback(auth, started.state, started.cookies);
      const headers = new Headers({ cookie: started.cookies });
      const firstToken = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      await expect(auth.microsoftProof.resend(headers)).rejects.toMatchObject({ status: 429 });
      db.prepare("UPDATE microsoft_identity_proofs SET lastSentAt = ?").run(Date.now() - 61_000);
      await auth.microsoftProof.resend(headers);
      expect(sentMessages).toHaveLength(2);
      const secondToken = new URL(sentMessages[1]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      expect(secondToken).not.toBe(firstToken);
      await expect(auth.microsoftProof.confirm(headers, firstToken)).rejects.toMatchObject({ status: 403 });
      expect(auth.microsoftProof.status(headers).state).toBe("pending");
      const resumed = await auth.microsoftProof.confirm(headers, secondToken);
      expect(resumed.url).toContain("state=");
    } finally {
      db.close();
    }
  });

  it("retains per-address send history across replacement intents for the full hour", async () => {
    const { db, auth } = await configured();
    try {
      mockMicrosoftToken(claims());
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const started = await begin(auth);
        const pending = await callback(auth, started.state, started.cookies);
        expect(pending.headers.get("location")).toContain("/verify-microsoft?state=check-email");
        db.prepare("UPDATE microsoft_identity_proofs SET lastSentAt = ? WHERE lastSentAt IS NOT NULL").run(
          Date.now() - 61_000,
        );
      }
      expect(sentMessages).toHaveLength(5);
      db.prepare("UPDATE microsoft_identity_proofs SET createdAt = ? WHERE sentCount > 0").run(
        Date.now() - 2 * 60 * 60_000,
      );
      const denied = await begin(auth);
      await callback(auth, denied.state, denied.cookies);
      expect(sentMessages).toHaveLength(5);
      expect(db.prepare("SELECT COALESCE(SUM(sentCount), 0) AS count FROM microsoft_identity_proofs").get()).toEqual({
        count: 5,
      });
    } finally {
      db.close();
    }
  });

  it("enforces the global send ceiling independently of address and source IP", async () => {
    const { db, auth } = await configured();
    try {
      mockMicrosoftToken(claims());
      const first = await begin(auth);
      await callback(auth, first.state, first.cookies);
      db.prepare(
        `UPDATE microsoft_identity_proofs SET sentCount = 300, targetEmail = 'other@example.com',
        sourceIpHash = 'other-client', oid = NULL, lastSentAt = ?`,
      ).run(Date.now() - 61_000);
      const next = await begin(auth);
      await callback(auth, next.state, next.cookies);
      expect(sentMessages).toHaveLength(1);
      expect(
        db.prepare("SELECT sentCount FROM microsoft_identity_proofs ORDER BY createdAt DESC, rowid DESC LIMIT 1").get(),
      ).toEqual({ sentCount: 0 });
    } finally {
      db.close();
    }
  });

  it("expires an unused proof after its 15-minute validity window", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      const headers = new Headers({ cookie: started.cookies });
      db.prepare("UPDATE microsoft_identity_proofs SET expiresAt = ?").run(Date.now() - 1);
      expect(auth.microsoftProof.status(headers)).toEqual({ state: "expired" });
      await expect(auth.microsoftProof.confirm(headers)).rejects.toMatchObject({ status: 410 });
    } finally {
      db.close();
    }
  });

  it("retires an expired approval before the same Microsoft object starts a replacement proof", async () => {
    const { db, auth } = await configured();
    try {
      const abandoned = await begin(auth);
      mockMicrosoftToken(claims());
      await callback(auth, abandoned.state, abandoned.cookies);
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      await auth.microsoftProof.confirm(new Headers({ cookie: abandoned.cookies }), token);
      db.prepare("UPDATE microsoft_identity_proofs SET expiresAt = ? WHERE state = 'approved'").run(Date.now() - 1);
      const replacement = await begin(auth);
      mockMicrosoftToken(claims("bruce@example.com"));
      const bound = await callback(auth, replacement.state, replacement.cookies);
      expect(bound.status).toBe(302);
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs ORDER BY createdAt, rowid").all()).toEqual([
        { state: "cancelled" },
        { state: "completed" },
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects a second callback whose object id differs from the approved mailbox proof", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken(claims());
      await callback(auth, started.state, started.cookies);
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: started.cookies }), token);
      mockMicrosoftToken({ ...claims(), oid: "different-object-id" });
      const rejected = await callback(
        auth,
        requiredState(resumed.url),
        replaceCookies(started.cookies, resumed.setCookies),
      );
      expect(rejected.status).toBe(302);
      expect(rejected.headers.get("location")).toContain("MICROSOFT_IDENTITY_MISMATCH");
      expect(db.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        count: 0,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("consumes one approved proof only once when completion callbacks race", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken(claims());
      await callback(auth, started.state, started.cookies);
      const token = new URL(sentMessages[0]?.text.match(/http[^\s]+/)?.[0] ?? "").hash.replace(/^#token=/, "");
      const resumed = await auth.microsoftProof.confirm(new Headers({ cookie: started.cookies }), token);
      const cookies = replaceCookies(started.cookies, resumed.setCookies);
      const state = requiredState(resumed.url);
      const results = await Promise.all([callback(auth, state, cookies), callback(auth, state, cookies)]);
      expect(results.map((response) => response.status).filter((status) => status === 302)).toHaveLength(1);
      expect(results.map((response) => response.status).filter((status) => status >= 400)).toHaveLength(1);
      expect(results.filter((response) => response.headers.get("location") === `${origin}/`)).toHaveLength(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM account WHERE providerId = 'microsoft'").get()).toEqual({
        count: 1,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "completed" });
    } finally {
      db.close();
    }
  });

  it.each([
    ["issuer", { iss: "https://login.microsoftonline.com/other/v2.0" }],
    ["audience", { aud: "other-client" }],
    ["expiry", { exp: Math.floor(Date.now() / 1000) - 30 }],
    ["tenant", { tid: "9188040d-6c67-4c5b-b112-36a304b66dad" }],
    ["object id", { oid: "" }],
  ])("refuses a %s mismatch before mailbox or account writes", async (_label, changed) => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      mockMicrosoftToken({ ...claims("bruce@example.com"), ...changed });
      const rejected = await callback(auth, started.state, started.cookies);
      expect(rejected.status).toBe(302);
      expect(rejected.headers.get("location")).toBe(
        `${origin}/?error=${_label === "object id" ? "unable_to_get_user_info" : "MICROSOFT_IDENTITY_INVALID"}`,
      );
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
      expect(sentMessages).toHaveLength(0);
      expect(db.prepare("SELECT state, oid FROM microsoft_identity_proofs").get()).toEqual({
        state: "started",
        oid: null,
      });
    } finally {
      db.close();
    }
  });

  it("invalidates a cancelled provider callback and rejects its delayed code", async () => {
    const { db, auth } = await configured();
    try {
      const started = await begin(auth);
      const noState = await auth.handler(
        new Request(`${origin}/api/auth/callback/microsoft?error=access_denied`, {
          headers: { cookie: started.cookies },
        }),
      );
      expect(noState.headers.get("location")).toContain("MICROSOFT_PROOF_CALLBACK_MISMATCH");
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "started" });
      const wrongState = await auth.handler(
        new Request(`${origin}/api/auth/callback/microsoft?error=access_denied&state=unrelated`, {
          headers: { cookie: started.cookies },
        }),
      );
      expect(wrongState.headers.get("location")).toContain("MICROSOFT_PROOF_CALLBACK_MISMATCH");
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "started" });
      const cancelled = await auth.handler(
        new Request(
          `${origin}/api/auth/callback/microsoft?error=access_denied&state=${encodeURIComponent(started.state)}`,
          { headers: { cookie: started.cookies } },
        ),
      );
      expect(cancelled.status).toBe(302);
      expect(cancelled.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(db.prepare("SELECT state FROM microsoft_identity_proofs").get()).toEqual({ state: "cancelled" });
      mockMicrosoftToken(claims("bruce@example.com"));
      const delayed = await callback(auth, started.state, started.cookies);
      expect(delayed.headers.get("location")).toContain("MICROSOFT_PROOF_CALLBACK_MISMATCH");
      expect(db.prepare("SELECT COUNT(*) AS count FROM user").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
