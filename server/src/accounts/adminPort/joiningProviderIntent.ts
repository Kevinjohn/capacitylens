import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import { AccountContractError, assertRetryAfterSeconds } from "@capacitylens/shared/account/errors";
import type { Db } from "../../db";
import { tx } from "../../txn";
import {
  insertJoinIntent,
  pruneJoinIntents,
  readJoinIntent,
  cancelJoinIntent,
} from "../../controlTables/joiningIntents";
import type { JoinIntent } from "../../controlTables/joiningIntents";
import { prepareCompanyAdmissionIntent } from "./joiningAdmission";
import { createAccountFailure } from "./failures";
import { cancelMicrosoftJoinForBrowser } from "../../authConfig/joiningReplacement";
import {
  hashJoiningSourceIp,
  hashJoiningValue,
  joiningCookie,
  joiningCookieNames,
  joiningEmailHint,
  newJoiningIntentId,
  newJoiningSecret,
  readJoiningCookie,
} from "./joiningIntentSecrets";

const TTL_MS = 15 * 60_000;
const RATE_WINDOW_MS = 60 * 60_000;

function emailAddress(raw: string): string {
  if (!isAccountEmail(raw) || parseApprovedDomain(raw.slice(raw.lastIndexOf("@") + 1)) === null) {
    throw createAccountFailure("VALIDATION_FAILED", "Enter a valid email address.");
  }
  return normalizeAccountEmail(raw);
}

function assertProviderStartQuota(db: Db, intent: JoinIntent, now: number): void {
  const recent = db
    .prepare(
      `SELECT COUNT(*) AS count FROM company_join_intents
    WHERE providerId <> 'password' AND createdAt > ?
      AND (email = ? OR browserHash = ? OR sourceIpHash = ?)`,
    )
    .get(now - RATE_WINDOW_MS, intent.email, intent.browserHash, intent.sourceIpHash) as { count: number };
  const global = db
    .prepare(
      `SELECT COUNT(*) AS count FROM company_join_intents
    WHERE providerId <> 'password' AND createdAt > ?`,
    )
    .get(now - RATE_WINDOW_MS) as { count: number };
  if (recent.count >= 10 || global.count >= 1000) {
    throw new AccountContractError({
      code: "RATE_LIMITED",
      message: "Too many sign-in attempts. Try again later.",
      retryable: true,
      retryAfterSeconds: assertRetryAfterSeconds(60),
    });
  }
}

export interface ProviderStartInput {
  accountId: string;
  purpose: "policy" | "invitation";
  invitationToken?: string;
  email: string;
  providerId: "google" | "github";
  headers: Headers;
  sourceIp: string;
  startOAuth: (callbackURL: string, errorCallbackURL: string) => Promise<{ url: string; setCookies: string[] }>;
  publicUrl: URL;
}

// eslint-disable-next-line max-lines-per-function -- The factory binds start, callback reads and cookie names to one secret.
export function createJoiningProviderIntent(input: {
  db: Db;
  applicationId: string;
  secret: string;
  secureCookies: boolean;
}) {
  const { db, applicationId, secret, secureCookies } = input;
  const names = joiningCookieNames({ applicationId: applicationId, secure: secureCookies });
  const fromHeaders = (headers: Headers): JoinIntent | null => {
    const nonce = readJoiningCookie(headers, names.intent);
    const browser = readJoiningCookie(headers, names.browser);
    if (!nonce || !browser) return null;
    const intent = readJoinIntent(db, hashJoiningValue("nonce", nonce));
    return intent?.browserHash === hashJoiningValue("browser", browser) ? intent : null;
  };

  // eslint-disable-next-line max-lines-per-function -- The pending OAuth state and replacement share one reservation boundary.
  async function start(value: ProviderStartInput) {
    const email = emailAddress(value.email);
    const browser = readJoiningCookie(value.headers, names.browser) ?? newJoiningSecret();
    const nonce = newJoiningSecret();
    const previous = fromHeaders(value.headers);
    const now = Date.now();
    const intent = tx(
      db,
      () => {
        pruneJoinIntents(db, now);
        const invite = prepareCompanyAdmissionIntent({
          db,
          accountId: value.accountId,
          purpose: value.purpose,
          email,
          ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }),
          now,
        });
        const principal = db.prepare("SELECT id FROM user WHERE lower(trim(email)) = ?").get(email) as
          { id: string } | undefined;
        if (
          db
            .prepare(
              `SELECT 1 FROM account_access_restrictions
        WHERE accountId = ? AND (principalId = ? OR verifiedEmail = ?) LIMIT 1`,
            )
            .get(value.accountId, principal?.id ?? "", email)
        )
          throw createAccountFailure("FORBIDDEN", "Access to this company is disabled.");
        const created: JoinIntent = {
          id: newJoiningIntentId(),
          nonceHash: hashJoiningValue("nonce", nonce),
          browserHash: hashJoiningValue("browser", browser),
          purpose: value.purpose,
          accountId: value.accountId,
          invitationId: invite?.id ?? null,
          email,
          principalId: principal?.id ?? null,
          providerId: value.providerId,
          state: "started",
          tokenHash: null,
          deliveryGeneration: 0,
          expiresAt: now + TTL_MS,
          sentCount: 0,
          lastSentAt: null,
          sourceIpHash: hashJoiningSourceIp(secret, value.sourceIp),
          providerStateHash: null,
          createdAt: now,
          updatedAt: now,
        };
        assertProviderStartQuota(db, created, now);
        insertJoinIntent(db, created);
        return created;
      },
      "immediate",
    );
    const target = new URL(`/join/${encodeURIComponent(intent.accountId)}`, value.publicUrl);
    if (value.invitationToken) target.searchParams.set("invite", value.invitationToken);
    const failure = new URL(target);
    failure.searchParams.set("externalSignInError", "1");
    try {
      const oauth = await value.startOAuth(target.href, failure.href);
      const state = new URL(oauth.url).searchParams.get("state");
      if (!state || state.length > 2048) throw new Error("Provider start did not return a native OAuth state.");
      tx(
        db,
        () => {
          const changed = db
            .prepare(
              `UPDATE company_join_intents SET providerStateHash = ?, updatedAt = ?
          WHERE id = ? AND state = 'started' AND providerStateHash IS NULL AND expiresAt > ?`,
            )
            .run(hashJoiningValue("state", state), Date.now(), intent.id, Date.now());
          if (changed.changes !== 1) throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining.");
          if (previous) cancelJoinIntent(db, previous.nonceHash, Date.now());
          cancelMicrosoftJoinForBrowser({ db, headers: value.headers, applicationId, secureCookies, now: Date.now() });
        },
        "immediate",
      );
      return {
        url: oauth.url,
        emailHint: joiningEmailHint(email),
        setCookies: [
          joiningCookie({ name: names.browser, value: browser, secure: secureCookies, maxAge: 3600 }),
          joiningCookie({ name: names.intent, value: nonce, secure: secureCookies, maxAge: 900 }),
          ...oauth.setCookies,
        ],
      };
    } catch (cause) {
      cancelJoinIntent(db, intent.nonceHash, Date.now());
      throw cause;
    }
  }

  return { start, fromHeaders };
}
