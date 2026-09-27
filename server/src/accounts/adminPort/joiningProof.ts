import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
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
import {
  hashJoiningSourceIp,
  hashJoiningValue,
  isJoiningSecret,
  joiningCookie,
  joiningCookieNames,
  joiningEmailHint,
  newJoiningIntentId,
  newJoiningSecret,
  readJoiningCookie,
} from "./joiningIntentSecrets";

const TTL_MS = 15 * 60_000;

interface JoiningProofInput {
  db: Db;
  identity: LocalIdentityPort;
  applicationId: string;
  secret: string;
  secureCookies: boolean;
  requireMfa: boolean;
  sendMail: (email: string, token: string, target: { accountId: string; invitationToken?: string }) => Promise<void>;
}

interface StartInput {
  accountId: string;
  purpose: "policy" | "invitation";
  invitationToken?: string;
  email: string;
  headers: Headers;
  sourceIp: string;
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
  const conflict = db
    .prepare(
      `SELECT 1 FROM account_members AS member
    JOIN account_access_restrictions AS restriction ON restriction.accountId = member.accountId
    WHERE member.userId = ? AND member.role = 'owner' AND member.status = 'active'
      AND (restriction.principalId = ? OR restriction.verifiedEmail = ?) LIMIT 1`,
    )
    .get(principalId, principalId, email);
  if (conflict) throw createAccountFailure("FORBIDDEN", "This address conflicts with Owner access.");
}

function recordPasswordProof(input: { db: Db; principalId: string; email: string; now: number }): void {
  const { db, principalId, email, now } = input;
  const principal = db.prepare("SELECT email FROM user WHERE id = ?").get(principalId) as { email: string } | undefined;
  if (!principal || normalizeAccountEmail(principal.email) !== email) {
    throw createAccountFailure("FORBIDDEN", "This identity no longer owns the verified address.");
  }
  assertProofOwnerCanKeepAccess(db, principalId, email);
  db.prepare(
    `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
    VALUES (?, ?, 'password', ?) ON CONFLICT(principalId) DO UPDATE SET
    email = excluded.email, source = excluded.source, provenAt = excluded.provenAt`,
  ).run(principalId, email, new Date(now).toISOString());
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
  const { browser: browserCookie, intent: intentCookie } = joiningCookieNames(applicationId, secureCookies);
  const fromHeaders = (headers: Headers) => {
    const nonce = readJoiningCookie(headers, intentCookie);
    const browser = readJoiningCookie(headers, browserCookie);
    if (!nonce || !browser) return null;
    const intent = readJoinIntent(db, hashJoiningValue("nonce", nonce));
    return intent?.browserHash === hashJoiningValue("browser", browser) ? intent : null;
  };
  const clearIntentCookie = () => joiningCookie({ name: intentCookie, value: "", secure: secureCookies, maxAge: 0 });

  async function deliver(
    intent: JoinIntent,
    token: string,
    delivery: { generation: number; invitationToken?: string },
  ): Promise<void> {
    try {
      await sendMail(intent.email, token, {
        accountId: intent.accountId,
        ...(delivery.invitationToken ? { invitationToken: delivery.invitationToken } : {}),
      });
    } catch {
      clearFailedJoinDelivery({
        db,
        id: intent.id,
        generation: delivery.generation,
        tokenHash: hashJoiningValue("mail", token),
      });
      throw new AccountContractError({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Verification email could not be sent. Try again shortly.",
        retryable: true,
      });
    }
  }

  function assertJoinStartUnrestricted(accountId: string, email: string): string | null {
    const principal = db.prepare("SELECT id FROM user WHERE lower(trim(email)) = ?").get(email) as
      { id: string } | undefined;
    const restriction = db
      .prepare(
        `SELECT 1 FROM account_access_restrictions
        WHERE accountId = ? AND (principalId = ? OR verifiedEmail = ?) LIMIT 1`,
      )
      .get(accountId, principal?.id ?? "", email);
    if (restriction) throw createAccountFailure("FORBIDDEN", "Access to this company is disabled.");
    return principal?.id ?? null;
  }

  function reserveStartIntent(input: {
    value: StartInput;
    email: string;
    browser: string;
    nonce: string;
    token: string;
    previous: JoinIntent | null;
    now: number;
  }): JoinIntent & { generation: number } {
    const { value, email, browser, nonce, token, previous, now } = input;
    return tx(
      db,
      () => {
        pruneJoinIntents(db, now);
        const invite = prepareCompanyAdmissionIntent({
          db,
          accountId: value.accountId,
          email,
          purpose: value.purpose,
          ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }),
          now,
        });
        const principalId = assertJoinStartUnrestricted(value.accountId, email);
        const created: JoinIntent = {
          id: newJoiningIntentId(),
          nonceHash: hashJoiningValue("nonce", nonce),
          browserHash: hashJoiningValue("browser", browser),
          purpose: value.purpose,
          accountId: value.accountId,
          invitationId: invite?.id ?? null,
          email,
          principalId,
          providerId: "password",
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
        // Quota and replacement are one transaction. A denied start leaves the previous journey intact.
        insertJoinIntent(db, created);
        const generation = reserveJoinDelivery({
          db,
          intent: created,
          tokenHash: hashJoiningValue("mail", token),
          now,
        });
        if (previous) cancelJoinIntent(db, previous.nonceHash, now);
        return { ...created, generation };
      },
      "immediate",
    );
  }

  async function start(value: StartInput) {
    const email = assertStartEmail(value.email);
    const now = Date.now();
    const browser = readJoiningCookie(value.headers, browserCookie) ?? newJoiningSecret();
    const nonce = newJoiningSecret();
    const token = newJoiningSecret();
    const previous = fromHeaders(value.headers);
    const intent = reserveStartIntent({ value, email, browser, nonce, token, previous, now });
    let deliveryUnavailable = false;
    try {
      await deliver(intent, token, {
        generation: intent.generation,
        ...(value.invitationToken ? { invitationToken: value.invitationToken } : {}),
      });
    } catch (error) {
      if (!(error instanceof AccountContractError) || error.failure.code !== "DEPENDENCY_UNAVAILABLE") throw error;
      deliveryUnavailable = true;
    }
    return {
      emailHint: joiningEmailHint(email),
      expiresAt: new Date(intent.expiresAt).toISOString(),
      deliveryUnavailable,
      setCookies: [
        joiningCookie({ name: browserCookie, value: browser, secure: secureCookies, maxAge: 3600 }),
        joiningCookie({ name: intentCookie, value: nonce, secure: secureCookies, maxAge: 900 }),
      ],
    };
  }

  function status(headers: Headers) {
    const intent = fromHeaders(headers);
    if (!intent || intent.expiresAt <= Date.now() || intent.state === "completed" || intent.state === "cancelled") {
      return { state: "expired" as const };
    }
    return {
      state: intent.state === "approved" ? ("approved" as const) : ("pending" as const),
      accountId: intent.accountId,
      purpose: intent.purpose,
      providerId: intent.providerId,
      email: intent.email,
      emailHint: joiningEmailHint(intent.email),
      deliveryUnavailable: intent.state === "started" && intent.sentCount > 0,
    };
  }

  async function resend(headers: Headers, invitationToken?: string) {
    const intent = fromHeaders(headers);
    if (!intent) throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining.");
    const token = newJoiningSecret();
    const generation = tx(
      db,
      () => {
        const current = readJoinIntent(db, intent.nonceHash);
        if (!current) throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining.");
        assertTargetStillMatches(db, current, invitationToken);
        return reserveJoinDelivery({
          db,
          intent: current,
          tokenHash: hashJoiningValue("mail", token),
          now: Date.now(),
        });
      },
      "immediate",
    );
    await deliver(intent, token, { generation, ...(invitationToken ? { invitationToken } : {}) });
    return { ok: true };
  }

  function confirm(headers: Headers, token: string) {
    if (!isJoiningSecret(token)) throw createAccountFailure("FORBIDDEN", "The verification link is invalid.");
    const intent = fromHeaders(headers);
    if (!intent) throw createAccountFailure("INVITATION_EXPIRED", "Open the link in the browser where you started.");
    const approved = tx(
      db,
      () =>
        approveJoinToken({
          db,
          nonceHash: intent.nonceHash,
          tokenHash: hashJoiningValue("mail", token),
          now: Date.now(),
        }),
      "immediate",
    );
    if (!approved) throw createAccountFailure("FORBIDDEN", "The verification link is invalid or expired.");
    return { state: "approved" as const };
  }

  function cancel(headers: Headers) {
    const intent = fromHeaders(headers);
    if (intent) tx(db, () => cancelJoinIntent(db, intent.nonceHash, Date.now()), "immediate");
    return { ok: true, setCookie: clearIntentCookie() };
  }

  async function completeNew(value: {
    headers: Headers;
    invitationToken?: string;
    displayName: string;
    password: string;
  }) {
    const intent = fromHeaders(value.headers);
    const now = Date.now();
    assertApproved(intent, now);
    if (intent.providerId !== "password" || intent.principalId !== null) {
      throw createAccountFailure("IDENTITY_ALREADY_EXISTS", "Sign in to your existing identity to continue.");
    }
    const created = await identity.createCorrelatedProvisionalCredentialPrincipal({
      email: intent.email,
      displayName: value.displayName,
      password: value.password,
      emailVerified: true,
      command: { commandId: intent.id, idempotencyKey: intent.nonceHash },
      correlatePrincipalInTransaction: (principalId) => {
        const current = readJoinIntent(db, intent.nonceHash);
        assertApproved(current, Date.now());
        assertTargetStillMatches(db, current, value.invitationToken);
        recordPasswordProof({ db, principalId, email: current.email, now: Date.now() });
        admitCompanyInTx({
          db,
          accountId: current.accountId,
          principalId,
          email: current.email,
          purpose: current.purpose,
          ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }),
        });
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
    return tx(
      db,
      () => {
        const current = readJoinIntent(db, intent.nonceHash);
        assertApproved(current, Date.now());
        assertTargetStillMatches(db, current, value.invitationToken);
        recordPasswordProof({ db, principalId: value.actor.principalId, email: current.email, now: Date.now() });
        const membership = admitCompanyInTx({
          db,
          accountId: current.accountId,
          principalId: value.actor.principalId,
          email: current.email,
          purpose: current.purpose,
          ...(value.invitationToken === undefined ? {} : { invitationToken: value.invitationToken }),
        });
        completeJoinIntent({ db, intent: current, principalId: value.actor.principalId, now: Date.now() });
        return { accountId: current.accountId, role: membership.role };
      },
      "immediate",
    );
  }

  return { start, status, resend, confirm, cancel, completeNew, completeExisting };
}
