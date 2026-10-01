import type { Db } from "../db";
import { tx } from "../txn";
import { cancelCompanyJoinForBrowser } from "../accounts/adminPort/joiningAdmission";
import type { createMicrosoftProofAuthorization } from "./microsoftProofAuthorization";
import type { createMicrosoftCallbackState } from "./microsoftProofCallbackState";
import {
  MicrosoftProofError,
  assertMicrosoftReturnUrl,
  hashProofValue,
  newProofId,
  newProofSecret,
  readProofCookie,
} from "./microsoftProofPrimitives";
import type {
  MicrosoftProofIntent,
  MicrosoftProofPurpose,
  createMicrosoftReturnUrlCipher,
} from "./microsoftProofPrimitives";

type Intent = MicrosoftProofIntent;
type Purpose = MicrosoftProofPurpose;
const TTL_MS = 15 * 60_000;
const RATE_WINDOW_MS = 60 * 60_000;

/** Reserve the exact target before OAuth and replace the old browser journey only after acceptance. */
// eslint-disable-next-line max-lines-per-function -- Reservation, quota and browser replacement form one start boundary.
export function createMicrosoftProofStart(input: {
  db: Db;
  authorization: Pick<ReturnType<typeof createMicrosoftProofAuthorization>, "resolveTarget">;
  callbackCipher: Pick<ReturnType<typeof createMicrosoftReturnUrlCipher>, "encrypt" | "hashIp">;
  callbackState: Pick<ReturnType<typeof createMicrosoftCallbackState>, "store">;
  fromHeaders: (headers: Headers) => Intent | null;
  startNativeOAuth: (headers: Headers, intent: Intent) => Promise<{ url: string; setCookies: string[] }>;
  cookie: (nonce: string) => string;
  browserCookieName: string;
  publicUrl: URL;
  origins: ReadonlySet<string>;
  tenantId: string;
  applicationId: string;
}) {
  const {
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
  } = input;
  function saveIntent(intent: Intent, now: number): void {
    db.prepare(
      `INSERT INTO microsoft_identity_proofs
      (id, nonceHash, purpose, targetEmail, inviteId, accountId, principalId, sessionId, tenantId, oid, tokenHash,
       state, expiresAt, tokenExpiresAt, sentCount, lastSentAt, sourceIpHash, browserHash,
       callbackUrl, errorCallbackUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'started', ?, NULL, 0, NULL, ?, ?, ?, ?, ?, ?)`,
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
      intent.browserHash,
      intent.callbackUrl,
      intent.errorCallbackUrl,
      now,
      now,
    );
  }

  function assertJoinStartQuota(targetEmail: string, sourceIp: string, browserHash: string): void {
    const since = Date.now() - RATE_WINDOW_MS;
    const sourceIpHash = callbackCipher.hashIp(sourceIp);
    const recent = db
      .prepare(
        `SELECT COUNT(*) AS count FROM microsoft_identity_proofs
        WHERE purpose = 'join' AND createdAt > ? AND (targetEmail = ? OR sourceIpHash = ? OR browserHash = ?)`,
      )
      .get(since, targetEmail, sourceIpHash, browserHash) as { count: number };
    const global = db
      .prepare(`SELECT COUNT(*) AS count FROM microsoft_identity_proofs WHERE purpose = 'join' AND createdAt > ?`)
      .get(since) as { count: number };
    if (recent.count >= 10 || global.count >= 1000) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_RATE_LIMITED", 429);
    }
  }

  // eslint-disable-next-line max-lines-per-function -- One reservation binds the target, browser, quota and encrypted redirects.
  async function start(args: {
    body: {
      purpose: Purpose;
      email?: string;
      inviteToken?: string;
      accountId?: string;
      callbackURL: string;
      errorCallbackURL: string;
    };
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
    const browser = body.purpose === "join" ? (readProofCookie(headers, browserCookieName) ?? newProofSecret()) : null;
    const browserHash = browser ? hashProofValue(`microsoft-join-browser\0${browser}`) : null;
    const previous = fromHeaders(headers);
    const nonce = newProofSecret();
    const now = Date.now();
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
      browserHash,
      oauthStateHash: null,
      oauthStateHistory: "[]",
      callbackUrl: callbackCipher.encrypt(callbackUrl),
      errorCallbackUrl: callbackCipher.encrypt(errorCallbackUrl),
    };
    tx(
      db,
      () => {
        db.prepare("DELETE FROM microsoft_identity_proofs WHERE COALESCE(lastSentAt, createdAt) < ?").run(
          now - RATE_WINDOW_MS,
        );
        if (body.purpose === "join") assertJoinStartQuota(targetEmail, args.sourceIp, browserHash as string);
        saveIntent(intent, now);
      },
      "immediate",
    );
    return beginNativeProof({ intent, headers, nonce, previous, browser });
  }

  async function beginNativeProof(input: {
    intent: Intent;
    headers: Headers;
    nonce: string;
    previous: Intent | null;
    browser: string | null;
  }) {
    const { intent, headers, nonce, previous, browser } = input;
    try {
      const oauth = await startNativeOAuth(headers, intent);
      tx(
        db,
        () => {
          callbackState.store(intent.id, oauth.url);
          if (previous)
            db.prepare(
              `UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL, updatedAt = ?
           WHERE id = ? AND (state IN ('started','mail-sent','approved') OR (purpose = 'join' AND state = 'completed'))`,
            ).run(Date.now(), previous.id);
          if (intent.purpose === "join")
            cancelCompanyJoinForBrowser({
              db,
              headers,
              applicationId,
              secureCookies: publicUrl.protocol === "https:",
              now: Date.now(),
            });
        },
        "immediate",
      );
      return {
        url: oauth.url,
        setCookies: [
          cookie(nonce),
          ...(browser
            ? [
                `${browserCookieName}=${browser}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${publicUrl.protocol === "https:" ? "; Secure" : ""}`,
              ]
            : []),
          ...oauth.setCookies,
        ],
      };
    } catch (error) {
      db.prepare("UPDATE microsoft_identity_proofs SET state = 'cancelled' WHERE id = ?").run(intent.id);
      throw error;
    }
  }

  return { start };
}
