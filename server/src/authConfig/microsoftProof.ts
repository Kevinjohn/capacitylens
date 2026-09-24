import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { microsoftCallbackCapture } from "./captureContexts";
import { createMicrosoftCallbackState } from "./microsoftProofCallbackState";
import { createMicrosoftProofAuthorization } from "./microsoftProofAuthorization";
import { createMicrosoftProofReturn } from "./microsoftProofReturn";
import {
  MicrosoftProofError,
  assertMicrosoftReturnUrl,
  createMicrosoftProofMailer,
  createMicrosoftReturnUrlCipher,
  equalProofHashes,
  hasVerifiedMicrosoftEmail,
  hashProofValue,
  hintProofEmail,
  newProofId,
  newProofSecret,
  readMicrosoftProofIntent,
  readProofCookie,
  type MicrosoftProofIntent,
  type MicrosoftProofPurpose,
  type MicrosoftProofSession,
} from "./microsoftProofPrimitives";

export { MicrosoftProofError } from "./microsoftProofPrimitives";
type Intent = MicrosoftProofIntent;
type Purpose = MicrosoftProofPurpose;

type Input = {
  db: Db;
  environment: Record<string, string | undefined>;
  secret: string;
  publicUrl: URL;
  applicationId: string;
  tenantId: string;
  trustedOrigins: readonly string[];
  getSession: (headers: Headers) => Promise<MicrosoftProofSession>;
  oauthStart: (headers: Headers, intent: MicrosoftProofIntent) => Promise<{ url: string; setCookies: string[] }>;
};

const TTL_MS = 15 * 60_000;
const RATE_WINDOW_MS = 60 * 60_000;

// eslint-disable-next-line max-lines-per-function -- The closure keeps the proof transitions tied to one database and browser-cookie policy.
export function createMicrosoftProof(input: Input) {
  const { db, environment, publicUrl, applicationId, tenantId } = input;
  const callbackCipher = createMicrosoftReturnUrlCipher(input.secret);
  const cookieName = `${publicUrl.protocol === "https:" ? `__Host-${applicationId}` : applicationId}-microsoft-proof`;
  const origins = new Set([publicUrl.origin, ...input.trustedOrigins.map((value) => new URL(value).origin)]);
  const mail = createMicrosoftProofMailer(environment, publicUrl);
  const cookieAttributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=900${publicUrl.protocol === "https:" ? "; Secure" : ""}`;
  const bootstrapEmails = new Set(
    (environment.SMALLSASS_ACCOUNT_PROVIDER_BOOTSTRAP_EMAILS ?? "")
      .split(",")
      .map(normalizeAccountEmail)
      .filter(Boolean),
  );
  const authorization = createMicrosoftProofAuthorization({ db, bootstrapEmails, getSession: input.getSession });

  function cookie(nonce: string): string {
    return `${cookieName}=${nonce}; ${cookieAttributes}`;
  }

  function startNativeOAuth(headers: Headers, intent: MicrosoftProofIntent) {
    const internalReturn = (outcome: "success" | "failure") => {
      const url = new URL("/api/auth/microsoft-proof-return", publicUrl);
      url.searchParams.set("intent", intent.id);
      url.searchParams.set("outcome", outcome);
      return url.toString();
    };
    return input.oauthStart(headers, {
      ...intent,
      callbackUrl: internalReturn("success"),
      errorCallbackUrl: internalReturn("failure"),
    });
  }

  function clearCookie(): string {
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${publicUrl.protocol === "https:" ? "; Secure" : ""}`;
  }

  function fromHeaders(headers: Headers): Intent | null {
    const nonce = readProofCookie(headers, cookieName);
    return nonce && nonce.length <= 128 ? readMicrosoftProofIntent(db, hashProofValue(nonce)) : null;
  }
  const callbackState = createMicrosoftCallbackState(db, fromHeaders);
  const callbackReturn = createMicrosoftProofReturn({
    publicUrl,
    fromHeaders,
    decrypt: callbackCipher.decrypt,
  });

  function assertRateLimit(intent: Intent): void {
    const now = Date.now();
    const recent = db
      .prepare(
        `SELECT COALESCE(SUM(sentCount), 0) AS count, MAX(lastSentAt) AS latest
      FROM microsoft_identity_proofs WHERE lastSentAt > ? AND
      (nonceHash = ? OR targetEmail = ? OR (oid IS NOT NULL AND oid = ?) OR sourceIpHash = ?)`,
      )
      .get(now - RATE_WINDOW_MS, intent.nonceHash, intent.targetEmail, intent.oid, intent.sourceIpHash) as {
      count: number;
      latest: number | null;
    };
    if (recent.count >= 5 || (recent.latest !== null && recent.latest > now - 60_000)) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_RATE_LIMITED", 429);
    }
    const global = db
      .prepare("SELECT COALESCE(SUM(sentCount), 0) AS count FROM microsoft_identity_proofs WHERE lastSentAt > ?")
      .get(now - RATE_WINDOW_MS) as { count: number };
    if (global.count >= 300) throw new MicrosoftProofError("MICROSOFT_PROOF_RATE_LIMITED", 429);
  }

  async function sendToken(intent: Intent): Promise<void> {
    assertRateLimit(intent);
    const token = newProofSecret();
    const now = Date.now();
    const changed = db
      .prepare(
        `UPDATE microsoft_identity_proofs
      SET state = 'mail-sent', tokenHash = ?, tokenExpiresAt = ?, sentCount = sentCount + 1,
          lastSentAt = ?, updatedAt = ? WHERE id = ? AND state IN ('started', 'mail-sent') AND expiresAt > ?`,
      )
      .run(hashProofValue(token), now + TTL_MS, now, now, intent.id, now);
    if (changed.changes !== 1) throw new MicrosoftProofError("MICROSOFT_PROOF_EXPIRED", 410);
    try {
      await mail(intent.targetEmail, token);
    } catch (error) {
      db.prepare(
        "UPDATE microsoft_identity_proofs SET state = 'started', tokenHash = NULL, tokenExpiresAt = NULL WHERE id = ? AND tokenHash = ?",
      ).run(intent.id, hashProofValue(token));
      logMailFailure(error, token);
      throw new MicrosoftProofError("MAIL_DELIVERY_UNAVAILABLE", 503);
    }
  }

  // Operators need the transport failure (host, credentials, certificate). Any address the
  // transport echoes, in whatever encoding, and the token stay out of the log.
  function logMailFailure(error: unknown, token: string): void {
    let message = "non-Error rejection";
    if (error instanceof Error) message = error.message;
    else if (typeof error === "string") message = error;
    console.error("Microsoft mailbox-proof email could not be sent.", {
      code: error instanceof Error ? (error as { code?: unknown }).code : undefined,
      reason: message.replaceAll(token, "[token]").replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, "[address]"),
    });
  }

  function saveIntent(intent: Intent, now: number): void {
    db.prepare(
      `INSERT INTO microsoft_identity_proofs
      (id, nonceHash, purpose, targetEmail, inviteId, accountId, principalId, sessionId, tenantId, oid, tokenHash,
       state, expiresAt, tokenExpiresAt, sentCount, lastSentAt, sourceIpHash, callbackUrl, errorCallbackUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'started', ?, NULL, 0, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      intent.id,
      intent.nonceHash,
      intent.purpose,
      intent.targetEmail,
      intent.inviteId,
      intent.accountId,
      intent.principalId,
      intent.sessionId,
      intent.tenantId,
      intent.expiresAt,
      intent.sourceIpHash,
      intent.callbackUrl,
      intent.errorCallbackUrl,
      now,
      now,
    );
  }

  async function start(args: {
    body: { purpose: Purpose; email?: string; inviteToken?: string; callbackURL: string; errorCallbackURL: string };
    headers: Headers;
    sourceIp: string;
  }): Promise<{ url: string; setCookies: string[] }> {
    const { body, headers } = args;
    const callbackUrl = assertMicrosoftReturnUrl(body.callbackURL, origins);
    const errorCallbackUrl = assertMicrosoftReturnUrl(body.errorCallbackURL, origins);
    const { targetEmail, inviteId, accountId, principalId, sessionId } = await authorization.resolveTarget(
      body,
      headers,
    );
    const previous = fromHeaders(headers);
    if (previous)
      db.prepare(
        "UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL WHERE id = ? AND state IN ('started','mail-sent','approved')",
      ).run(previous.id);
    const nonce = newProofSecret();
    const now = Date.now();
    db.prepare("DELETE FROM microsoft_identity_proofs WHERE COALESCE(lastSentAt, createdAt) < ?").run(
      now - RATE_WINDOW_MS,
    );
    const intent: Intent = {
      id: newProofId(),
      nonceHash: hashProofValue(nonce),
      purpose: body.purpose,
      targetEmail,
      inviteId,
      accountId,
      principalId,
      sessionId,
      tenantId,
      oid: null,
      tokenHash: null,
      state: "started",
      expiresAt: now + TTL_MS,
      tokenExpiresAt: null,
      sentCount: 0,
      lastSentAt: null,
      sourceIpHash: callbackCipher.hashIp(args.sourceIp),
      oauthStateHash: null,
      oauthStateHistory: "[]",
      callbackUrl: callbackCipher.encrypt(callbackUrl),
      errorCallbackUrl: callbackCipher.encrypt(errorCallbackUrl),
    };
    saveIntent(intent, now);
    try {
      const oauth = await startNativeOAuth(headers, intent);
      callbackState.store(intent.id, oauth.url);
      return { url: oauth.url, setCookies: [cookie(nonce), ...oauth.setCookies] };
    } catch (error) {
      db.prepare("UPDATE microsoft_identity_proofs SET state = 'cancelled' WHERE id = ?").run(intent.id);
      throw error;
    }
  }

  async function continueFirstProfile(profile: Record<string, unknown>, oid: string, intent: Intent): Promise<void> {
    const capture = microsoftCallbackCapture.getStore();
    if (!capture) throw new MicrosoftProofError("MICROSOFT_CALLBACK_REQUIRED", 403);
    if (intent.state === "approved") {
      capture.proofId = intent.id;
      return;
    }
    if (intent.state === "mail-sent") {
      capture.pending = true;
      throw new MicrosoftProofError("MICROSOFT_PROOF_PENDING", 403);
    }
    db.prepare(
      "UPDATE microsoft_identity_proofs SET oid = ?, updatedAt = ? WHERE id = ? AND state = 'started' AND oid IS NULL",
    ).run(oid, Date.now(), intent.id);
    if (hasVerifiedMicrosoftEmail(profile, intent.targetEmail)) {
      retireExpiredApprovals(oid);
      db.prepare(
        "UPDATE microsoft_identity_proofs SET state = 'approved', updatedAt = ? WHERE id = ? AND state = 'started'",
      ).run(Date.now(), intent.id);
      capture.proofId = intent.id;
      return;
    }
    try {
      await sendToken({ ...intent, oid });
    } catch (error) {
      if (error instanceof MicrosoftProofError && error.code === "MAIL_DELIVERY_UNAVAILABLE") capture.pending = true;
      throw error;
    }
    capture.pending = true;
    throw new MicrosoftProofError("MICROSOFT_PROOF_PENDING", 403);
  }

  async function onProfile(
    profile: Record<string, unknown>,
    oid: string,
  ): Promise<{ email: string; emailVerified: true }> {
    const capture = microsoftCallbackCapture.getStore();
    if (!capture) throw new MicrosoftProofError("MICROSOFT_CALLBACK_REQUIRED", 403);
    const existing = db
      .prepare(
        `SELECT user.email FROM account JOIN user ON user.id = account.userId
      WHERE account.providerId = 'microsoft' AND account.accountId = ? LIMIT 1`,
      )
      .get(oid) as { email: string } | undefined;
    const intent = fromHeaders(capture.request.headers);
    if (existing && isInactiveIntent(intent)) {
      return { email: existing.email, emailVerified: true };
    }
    if (!intent) throw new MicrosoftProofError("MICROSOFT_PROOF_REQUIRED", 403);
    await authorization.assertLive(intent, capture.request.headers);
    if (intent.tenantId !== tenantId || (intent.oid !== null && intent.oid !== oid))
      throw new MicrosoftProofError("MICROSOFT_IDENTITY_MISMATCH", 403);
    // An invite for an already linked Microsoft identity signs in to that linked principal: the
    // principal is found by `oid`, never by email, and the invite must name its stored address.
    if (existing) {
      if (!matchesExistingInvitation(intent, existing.email)) {
        throw new MicrosoftProofError("MICROSOFT_IDENTITY_ALREADY_LINKED", 409);
      }
      db.prepare("UPDATE microsoft_identity_proofs SET state = 'completed', tokenHash = NULL WHERE id = ?").run(
        intent.id,
      );
      return { email: existing.email, emailVerified: true };
    }
    await continueFirstProfile(profile, oid, intent);
    return { email: intent.targetEmail, emailVerified: true };
  }

  function isInactiveIntent(intent: Intent | null): boolean {
    return !intent || intent.state === "completed" || intent.state === "cancelled" || intent.expiresAt <= Date.now();
  }

  function matchesExistingInvitation(intent: Intent, email: string): boolean {
    return intent.purpose === "invite" && normalizeAccountEmail(email) === intent.targetEmail;
  }

  function status(headers: Headers): {
    state: "pending" | "approved" | "expired";
    emailHint?: string;
    deliveryUnavailable?: true;
  } {
    const intent = fromHeaders(headers);
    if (!intent || intent.expiresAt <= Date.now() || intent.state === "cancelled" || intent.state === "completed")
      return { state: "expired" };
    return {
      state: intent.state === "approved" ? "approved" : "pending",
      emailHint: hintProofEmail(intent.targetEmail),
      ...(intent.state === "started" && intent.oid && intent.sentCount > 0
        ? { deliveryUnavailable: true as const }
        : {}),
    };
  }

  async function confirm(headers: Headers, token?: string): Promise<{ url: string; setCookies: string[] }> {
    const intent = fromHeaders(headers);
    if (!intent) throw new MicrosoftProofError("MICROSOFT_PROOF_EXPIRED", 410);
    await authorization.assertLive(intent, headers);
    approveToken(intent, token);
    const oauth = await startNativeOAuth(headers, intent);
    callbackState.store(intent.id, oauth.url);
    return oauth;
  }

  function approveToken(intent: Intent, token?: string): void {
    if (token && !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MicrosoftProofError("MICROSOFT_PROOF_INVALID", 403);
    if (intent.state === "approved") {
      if (token && !matchesToken(intent, token)) {
        throw new MicrosoftProofError("MICROSOFT_PROOF_INVALID", 403);
      }
      return;
    }
    if (!token || !freshMailToken(intent, token)) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_INVALID", 403);
    }
    if (intent.oid) retireExpiredApprovals(intent.oid);
    const changed = db
      .prepare(
        "UPDATE microsoft_identity_proofs SET state = 'approved', updatedAt = ? WHERE id = ? AND state = 'mail-sent' AND tokenHash = ?",
      )
      .run(Date.now(), intent.id, intent.tokenHash);
    if (changed.changes !== 1) throw new MicrosoftProofError("MICROSOFT_PROOF_INVALID", 403);
  }

  function matchesToken(intent: Intent, token: string): boolean {
    return Boolean(intent.tokenHash && equalProofHashes(hashProofValue(token), intent.tokenHash));
  }

  function freshMailToken(intent: Intent, token: string): boolean {
    return (
      intent.state === "mail-sent" &&
      Boolean(intent.tokenExpiresAt && intent.tokenExpiresAt > Date.now()) &&
      matchesToken(intent, token)
    );
  }

  function retireExpiredApprovals(oid: string): void {
    const now = Date.now();
    db.prepare(
      `UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL, updatedAt = ?
      WHERE tenantId = ? AND oid = ? AND state = 'approved' AND expiresAt <= ?`,
    ).run(now, tenantId, oid, now);
  }

  async function resend(headers: Headers): Promise<void> {
    const intent = fromHeaders(headers);
    if (!intent) throw new MicrosoftProofError("MICROSOFT_PROOF_EXPIRED", 410);
    await authorization.assertLive(intent, headers);
    if (intent.state !== "mail-sent" && !(intent.state === "started" && intent.oid))
      throw new MicrosoftProofError("MICROSOFT_PROOF_INVALID", 409);
    await sendToken(intent);
  }

  function cancel(headers: Headers): string {
    const intent = fromHeaders(headers);
    if (intent)
      db.prepare(
        "UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL WHERE id = ? AND state IN ('started','mail-sent','approved')",
      ).run(intent.id);
    return clearCookie();
  }

  function releaseBootstrapClaim(token: string): void {
    db.prepare("DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?").run(token);
  }

  return {
    start,
    onProfile,
    status,
    confirm,
    resend,
    cancel,
    validateCallback: callbackState.validate,
    releaseBootstrapClaim,
    errorReturnUrl: callbackReturn.errorReturnUrl,
    resolveInternalReturn: callbackReturn.resolveInternalReturn,
    cookieName,
    applicationId: input.applicationId,
  };
}

export type MicrosoftProof = ReturnType<typeof createMicrosoftProof>;
