import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../../db";
import { tx } from "../../txn";
import {
  approveJoinToken,
  cancelJoinIntent,
  clearFailedJoinDelivery,
  completeJoinIntent,
  insertJoinIntent,
  pruneJoinIntents,
  readJoinIntent,
  reserveJoinDelivery,
  type JoinIntent,
} from "../../controlTables/joiningIntents";
import { admitCompanyInTx, prepareCompanyAdmissionIntent } from "./joiningAdmission";
import { createAccountFailure } from "./failures";
import type { LocalIdentityPort } from "../identityPort/contracts";

const TTL_MS = 15 * 60_000;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

interface JoiningProofInput {
  db: Db;
  identity: LocalIdentityPort;
  applicationId: string;
  secret: string;
  secureCookies: boolean;
  requireMfa: boolean;
  sendMail: (email: string, token: string, accountId: string) => Promise<void>;
}

interface StartInput {
  accountId: string;
  purpose: "policy" | "invitation";
  invitationToken?: string;
  email: string;
  headers: Headers;
  sourceIp: string;
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

function hash(kind: string, value: string): string {
  return createHash("sha256").update(`company-join-${kind}\0`).update(value).digest("hex");
}

function readCookie(headers: Headers, name: string): string | null {
  const prefix = `${name}=`;
  for (const entry of (headers.get("cookie") ?? "").split(";")) {
    const value = entry.trim();
    if (value.startsWith(prefix)) {
      const secret = value.slice(prefix.length);
      return SECRET_RE.test(secret) ? secret : null;
    }
  }
  return null;
}

function cookie(input: { name: string; value: string; secure: boolean; maxAge: number }): string {
  const { name, value, secure, maxAge } = input;
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function hint(email: string): string {
  return `${email.slice(0, 1)}***${email.slice(email.indexOf("@"))}`;
}

function assertStartEmail(raw: string): string {
  if (!isAccountEmail(raw) || parseApprovedDomain(raw.slice(raw.lastIndexOf("@") + 1)) === null) {
    throw createAccountFailure("VALIDATION_FAILED", "Enter a valid email address.");
  }
  return normalizeAccountEmail(raw);
}

function assertApproved(intent: JoinIntent | null, now: number): asserts intent is JoinIntent {
  if (!intent || intent.state !== "approved" || intent.expiresAt <= now) {
    throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining to verify your email again.");
  }
}

function assertProofOwnerCanKeepAccess(db: Db, principalId: string, email: string): void {
  const conflict = db.prepare(`SELECT 1 FROM account_members AS member
    JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
    WHERE member.userId = ? AND member.role = 'owner' AND member.status = 'active'
      AND (restriction.principalId = ? OR restriction.verifiedEmail = ?) LIMIT 1`).get(principalId, principalId, email);
  if (conflict) throw createAccountFailure("FORBIDDEN", "This address conflicts with Owner access.");
}

function recordPasswordProof(input: { db: Db; principalId: string; email: string; now: number }): void {
  const { db, principalId, email, now } = input;
  const principal = db.prepare("SELECT email FROM user WHERE id = ?").get(principalId) as { email: string } | undefined;
  if (!principal || normalizeAccountEmail(principal.email) !== email) {
    throw createAccountFailure("FORBIDDEN", "This identity no longer owns the verified address.");
  }
  assertProofOwnerCanKeepAccess(db, principalId, email);
  db.prepare(`INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
    VALUES (?, ?, 'password', ?) ON CONFLICT(principalId) DO UPDATE SET
    email = excluded.email, source = excluded.source, provenAt = excluded.provenAt`).run(
    principalId, email, new Date(now).toISOString(),
  );
}

function assertTargetStillMatches(db: Db, intent: JoinIntent, invitationToken?: string): void {
  const invite = prepareCompanyAdmissionIntent({
    db,
    accountId: intent.accountId,
    email: intent.email,
    purpose: intent.purpose,
    ...(invitationToken === undefined ? {} : { invitationToken }),
  });
  if ((invite?.id ?? null) !== intent.invitationId) {
    throw createAccountFailure("INVITATION_EXPIRED", "This invitation changed. Restart company joining.");
  }
}

// eslint-disable-next-line max-lines-per-function -- One factory keeps browser-cookie, quota and admission transitions bound to one database.
export function createJoiningProof(input: JoiningProofInput) {
  const { db, identity, applicationId, secret, secureCookies, requireMfa, sendMail } = input;
  const prefix = `${secureCookies ? "__Host-" : ""}${applicationId}-join`;
  const browserCookie = `${prefix}-browser`;
  const intentCookie = `${prefix}-intent`;
  const ipHash = (sourceIp: string) => createHmac("sha256", secret).update("company-join-ip\0").update(sourceIp).digest("hex");
  const fromHeaders = (headers: Headers) => {
    const nonce = readCookie(headers, intentCookie);
    const browser = readCookie(headers, browserCookie);
    if (!nonce || !browser) return null;
    const intent = readJoinIntent(db, hash("nonce", nonce));
    return intent?.browserHash === hash("browser", browser) ? intent : null;
  };
  const clearIntentCookie = () => cookie({ name: intentCookie, value: "", secure: secureCookies, maxAge: 0 });

  async function deliver(intent: JoinIntent, token: string, generation: number): Promise<void> {
    try {
      await sendMail(intent.email, token, intent.accountId);
    } catch {
      clearFailedJoinDelivery({ db, id: intent.id, generation, tokenHash: hash("mail", token) });
      throw new AccountContractError({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Verification email could not be sent. Try again shortly.",
        retryable: true,
      });
    }
  }

  async function start(value: StartInput) {
    const email = assertStartEmail(value.email);
    const now = Date.now();
    const browser = readCookie(value.headers, browserCookie) ?? newSecret();
    const nonce = newSecret();
    const token = newSecret();
    const previous = fromHeaders(value.headers);
    const intent = tx(db, () => {
      pruneJoinIntents(db, now);
      const invite = prepareCompanyAdmissionIntent({
        db, accountId: value.accountId, email, purpose: value.purpose,
        ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }),
        now,
      });
      const principal = db.prepare("SELECT id FROM user WHERE lower(trim(email)) = ?").get(email) as
        { id: string } | undefined;
      const restriction = db.prepare(`SELECT 1 FROM account_access_restrictions
        WHERE accountId = ? AND (principalId = ? OR verifiedEmail = ?) LIMIT 1`).get(
        value.accountId, principal?.id ?? "", email,
      );
      if (restriction) throw createAccountFailure("FORBIDDEN", "Access to this company is disabled.");
      const created: JoinIntent = {
        id: randomUUID(), nonceHash: hash("nonce", nonce), browserHash: hash("browser", browser),
        purpose: value.purpose, accountId: value.accountId, invitationId: invite?.id ?? null,
        email, principalId: principal?.id ?? null, providerId: "password", state: "started",
        tokenHash: null, deliveryGeneration: 0, expiresAt: now + TTL_MS,
        sentCount: 0, lastSentAt: null, sourceIpHash: ipHash(value.sourceIp),
        providerStateHash: null, createdAt: now, updatedAt: now,
      };
      // Quota and replacement are one transaction. A denied start leaves the previous journey intact.
      insertJoinIntent(db, created);
      const generation = reserveJoinDelivery({ db, intent: created, tokenHash: hash("mail", token), now });
      if (previous) cancelJoinIntent(db, previous.nonceHash, now);
      return { ...created, generation };
    }, "immediate");
    let deliveryUnavailable = false;
    try {
      await deliver(intent, token, intent.generation);
    } catch (error) {
      if (!(error instanceof AccountContractError) || error.failure.code !== "DEPENDENCY_UNAVAILABLE") throw error;
      deliveryUnavailable = true;
    }
    return {
      emailHint: hint(email), expiresAt: new Date(intent.expiresAt).toISOString(),
      deliveryUnavailable,
      setCookies: [
        cookie({ name: browserCookie, value: browser, secure: secureCookies, maxAge: 3600 }),
        cookie({ name: intentCookie, value: nonce, secure: secureCookies, maxAge: 900 }),
      ],
    };
  }

  function status(headers: Headers) {
    const intent = fromHeaders(headers);
    if (!intent || intent.expiresAt <= Date.now() || intent.state === "completed" || intent.state === "cancelled") {
      return { state: "expired" as const };
    }
    return { state: intent.state === "approved" ? "approved" as const : "pending" as const,
      emailHint: hint(intent.email), deliveryUnavailable: intent.state === "started" && intent.sentCount > 0 };
  }

  async function resend(headers: Headers) {
    const intent = fromHeaders(headers);
    if (!intent) throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining.");
    const token = newSecret();
    const generation = tx(db, () => {
      const current = readJoinIntent(db, intent.nonceHash);
      if (!current) throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining.");
      return reserveJoinDelivery({ db, intent: current, tokenHash: hash("mail", token), now: Date.now() });
    }, "immediate");
    await deliver(intent, token, generation);
    return { ok: true };
  }

  function confirm(headers: Headers, token: string) {
    if (!SECRET_RE.test(token)) throw createAccountFailure("FORBIDDEN", "The verification link is invalid.");
    const intent = fromHeaders(headers);
    if (!intent) throw createAccountFailure("INVITATION_EXPIRED", "Open the link in the browser where you started.");
    const approved = tx(db, () => approveJoinToken({
      db, nonceHash: intent.nonceHash, tokenHash: hash("mail", token), now: Date.now(),
    }), "immediate");
    if (!approved) throw createAccountFailure("FORBIDDEN", "The verification link is invalid or expired.");
    return { state: "approved" as const };
  }

  function cancel(headers: Headers) {
    const intent = fromHeaders(headers);
    if (intent) tx(db, () => cancelJoinIntent(db, intent.nonceHash, Date.now()), "immediate");
    return { ok: true, setCookie: clearIntentCookie() };
  }

  async function completeNew(value: {
    headers: Headers; invitationToken?: string; displayName: string; password: string;
  }) {
    const intent = fromHeaders(value.headers);
    const now = Date.now();
    assertApproved(intent, now);
    if (intent.providerId !== "password" || intent.principalId !== null) {
      throw createAccountFailure("IDENTITY_ALREADY_EXISTS", "Sign in to your existing identity to continue.");
    }
    const created = await identity.createCorrelatedProvisionalCredentialPrincipal({
      email: intent.email, displayName: value.displayName, password: value.password, emailVerified: true,
      command: { commandId: intent.id, idempotencyKey: intent.nonceHash },
      correlatePrincipalInTransaction: (principalId) => {
        const current = readJoinIntent(db, intent.nonceHash);
        assertApproved(current, Date.now());
        assertTargetStillMatches(db, current, value.invitationToken);
        recordPasswordProof({ db, principalId, email: current.email, now: Date.now() });
        admitCompanyInTx({ db, accountId: current.accountId, principalId, email: current.email,
          purpose: current.purpose, ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }) });
        completeJoinIntent({ db, intent: current, principalId, now: Date.now() });
      },
    });
    return { accountId: intent.accountId, principalId: created.principalId, signInRequired: true as const };
  }

  function completeExisting(value: { headers: Headers; actor: ActorContext; invitationToken?: string }) {
    const intent = fromHeaders(value.headers);
    const now = Date.now();
    assertApproved(intent, now);
    if (intent.principalId !== value.actor.principalId || (requireMfa && !value.actor.mfaSatisfied)) {
      throw createAccountFailure("AUTHENTICATION_REQUIRED", "Sign in as the addressed identity to continue.");
    }
    return tx(db, () => {
      const current = readJoinIntent(db, intent.nonceHash);
      assertApproved(current, Date.now());
      assertTargetStillMatches(db, current, value.invitationToken);
      recordPasswordProof({ db, principalId: value.actor.principalId, email: current.email, now: Date.now() });
      const membership = admitCompanyInTx({ db, accountId: current.accountId, principalId: value.actor.principalId,
        email: current.email, purpose: current.purpose,
        ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }) });
      completeJoinIntent({ db, intent: current, principalId: value.actor.principalId, now: Date.now() });
      return { accountId: current.accountId, role: membership.role };
    }, "immediate");
  }

  return { start, status, resend, confirm, cancel, completeNew, completeExisting };
}
