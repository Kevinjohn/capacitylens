import { createMailSender, resolveMailDeliveryCause, type MailSender } from "./mailSender";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { tx } from "../txn";
import { createMicrosoftCallbackState } from "./microsoftProofCallbackState";
import { createMicrosoftProofAuthorization } from "./microsoftProofAuthorization";
import { createMicrosoftProofReturn } from "./microsoftProofReturn";
import { createMicrosoftProofStart } from "./microsoftProofStart";
import { createMicrosoftProofProfiles } from "./microsoftProofProfiles";
import { createMicrosoftProofJoining } from "./microsoftProofJoining";
import {
  MicrosoftProofError,
  createMicrosoftProofMailer,
  createMicrosoftReturnUrlCipher,
  equalProofHashes,
  hashProofValue,
  hintProofEmail,
  newProofSecret,
  readMicrosoftProofIntent,
  readProofCookie,
  type MicrosoftProofIntent,
  type MicrosoftProofSession,
} from "./microsoftProofPrimitives";

export { MicrosoftProofError } from "./microsoftProofPrimitives";
type Intent = MicrosoftProofIntent;

type Input = {
  db: Db;
  environment: Record<string, string | undefined>;
  mail?: MailSender;
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
  const browserCookieName = `${publicUrl.protocol === "https:" ? `__Host-${applicationId}` : applicationId}-microsoft-join-browser`;
  const origins = new Set([publicUrl.origin, ...input.trustedOrigins.map((value) => new URL(value).origin)]);
  const mail = createMicrosoftProofMailer(input.mail ?? createMailSender(environment), publicUrl);
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
    const intent = nonce && nonce.length <= 128 ? readMicrosoftProofIntent(db, hashProofValue(nonce)) : null;
    if (intent?.purpose !== "join") return intent;
    const browser = readProofCookie(headers, browserCookieName);
    return browser &&
      /^[A-Za-z0-9_-]{43}$/.test(browser) &&
      intent.browserHash === hashProofValue(`microsoft-join-browser\0${browser}`)
      ? intent
      : null;
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
      (browserHash = ? OR targetEmail = ? OR (oid IS NOT NULL AND oid = ?) OR sourceIpHash = ?)`,
      )
      .get(now - RATE_WINDOW_MS, intent.browserHash, intent.targetEmail, intent.oid, intent.sourceIpHash) as {
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
    const token = newProofSecret();
    const now = Date.now();
    const changed = tx(
      db,
      () => {
        assertRateLimit(intent);
        return db
          .prepare(
            `UPDATE microsoft_identity_proofs
      SET state = 'mail-sent', tokenHash = ?, tokenExpiresAt = ?, sentCount = sentCount + 1,
          lastSentAt = ?, updatedAt = ? WHERE id = ? AND state IN ('started', 'mail-sent') AND expiresAt > ?`,
          )
          .run(hashProofValue(token), now + TTL_MS, now, now, intent.id, now);
      },
      "immediate",
    );
    if (changed.changes !== 1) throw new MicrosoftProofError("MICROSOFT_PROOF_EXPIRED", 410);
    try {
      await mail(intent.targetEmail, token);
    } catch (cause) {
      db.prepare(
        "UPDATE microsoft_identity_proofs SET state = 'started', tokenHash = NULL, tokenExpiresAt = NULL WHERE id = ? AND tokenHash = ?",
      ).run(intent.id, hashProofValue(token));
      const diagnostic = resolveMailDeliveryCause(cause);
      console.error("Microsoft mailbox proof delivery failed.", diagnostic);
      throw new MicrosoftProofError("MAIL_DELIVERY_UNAVAILABLE", 503, { cause: diagnostic });
    }
  }

  const { start } = createMicrosoftProofStart({
    db,
    authorization,
    callbackCipher,
    callbackState,
    fromHeaders,
    startNativeOAuth,
    cookie,
    browserCookieName,
    publicUrl,
    origins,
    tenantId,
    applicationId,
  });

  const { onProfile } = createMicrosoftProofProfiles({
    db,
    fromHeaders,
    authorization,
    tenantId,
    sendToken,
    retireExpiredApprovals,
  });

  function isUnavailableStatus(intent: Intent): boolean {
    return (
      intent.expiresAt <= Date.now() ||
      intent.state === "cancelled" ||
      (intent.state === "completed" && intent.purpose !== "join")
    );
  }

  function status(headers: Headers): {
    state: "pending" | "approved" | "expired";
    emailHint?: string;
    deliveryUnavailable?: true;
    accountId?: string;
    purpose?: "policy" | "invitation";
    providerId?: "microsoft";
  } {
    const intent = fromHeaders(headers);
    if (!intent || isUnavailableStatus(intent)) return { state: "expired" };
    return {
      state: intent.state === "approved" || intent.state === "completed" ? "approved" : "pending",
      emailHint: hintProofEmail(intent.targetEmail),
      ...(intent.purpose === "join" && intent.accountId
        ? {
            accountId: intent.accountId,
            purpose: intent.inviteId ? ("invitation" as const) : ("policy" as const),
            providerId: "microsoft" as const,
          }
        : {}),
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
    const changed = tx(
      db,
      () => {
        if (intent.oid) retireExpiredApprovals(intent.oid);
        return db
          .prepare(
            "UPDATE microsoft_identity_proofs SET state = 'approved', updatedAt = ? WHERE id = ? AND state = 'mail-sent' AND tokenHash = ?",
          )
          .run(Date.now(), intent.id, intent.tokenHash);
      },
      "immediate",
    );
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
        `UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL
         WHERE id = ? AND (state IN ('started','mail-sent','approved') OR (purpose = 'join' AND state = 'completed'))`,
      ).run(intent.id);
    return clearCookie();
  }

  function releaseBootstrapClaim(token: string): void {
    db.prepare("DELETE FROM capacitylens_bootstrap_claim WHERE id = 1 AND claimToken = ?").run(token);
  }

  const { admitsNewJoiningIdentity, bindJoiningSession, completeJoining } = createMicrosoftProofJoining({
    db,
    fromHeaders,
    applicationId,
  });

  return {
    start,
    onProfile,
    status,
    confirm,
    resend,
    cancel,
    validateCallback: callbackState.assertCallbackState,
    releaseBootstrapClaim,
    admitsNewJoiningIdentity,
    bindJoiningSession,
    completeJoining,
    errorReturnUrl: callbackReturn.errorReturnUrl,
    resolveInternalReturn: callbackReturn.resolveInternalReturn,
    cookieName,
    applicationId: input.applicationId,
  };
}

export type MicrosoftProof = ReturnType<typeof createMicrosoftProof>;
