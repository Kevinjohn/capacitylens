import { AsyncLocalStorage } from "node:async_hooks";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { ActorContext } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";
import { tx } from "../../txn";
import { completeJoinIntent, type JoinIntent } from "../../controlTables/joiningIntents";
import { admitCompanyInTx, assertJoinIntentTargetLive, prepareCompanyAdmissionIntent } from "./joiningAdmission";
import { createAccountFailure } from "./failures";
import { hashJoiningValue } from "./joiningIntentSecrets";
import { createJoiningProviderIntent } from "./joiningProviderIntent";
import { federatedCallbackCapture } from "../../authConfig/captureContexts";

export interface JoiningProviderFacts {
  providerId: "google" | "github";
  subject: string;
  email: string;
}

interface CallbackContext {
  intentId: string;
  stateHash: string;
  providerId: JoiningProviderFacts["providerId"];
}

export const joiningProviderCallbackCapture = new AsyncLocalStorage<CallbackContext>();

/** Only request-local provider mapper facts from the current callback are admission evidence. */
export function currentJoiningProviderFacts(providerId: string | null): JoiningProviderFacts | null {
  if (providerId === "google" || providerId === "github") {
    const capture = federatedCallbackCapture.getStore();
    if (capture?.active && capture.providerId === providerId && capture.subject && capture.email) {
      return { providerId, subject: capture.subject, email: capture.email };
    }
  }
  return null;
}

export class JoiningProviderCallbackError extends Error {
  constructor(
    readonly code = "company_join_expired",
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

function assertCallbackIntent(db: Db, capture: CallbackContext): JoinIntent {
  const intent = db.prepare("SELECT * FROM company_join_intents WHERE id = ?").get(capture.intentId) as
    JoinIntent | undefined;
  if (
    !intent ||
    intent.state !== "started" ||
    intent.expiresAt <= Date.now() ||
    intent.providerId !== capture.providerId ||
    intent.providerStateHash !== capture.stateHash
  ) {
    throw new JoiningProviderCallbackError();
  }
  try {
    assertJoinIntentTargetLive(db, intent);
  } catch (error) {
    throw new JoiningProviderCallbackError("company_join_policy_changed", { cause: error });
  }
  return intent;
}

function matchingFacts(intent: JoinIntent, facts: JoiningProviderFacts | null): facts is JoiningProviderFacts {
  return Boolean(
    facts &&
    facts.providerId === intent.providerId &&
    facts.subject &&
    isAccountEmail(facts.email) &&
    normalizeAccountEmail(facts.email) === intent.email,
  );
}

/** The native callback state, not a browser-supplied company id, selects the pending intent. */
// eslint-disable-next-line max-lines-per-function -- The callback lifecycle shares one intent-cookie and database boundary.
export function createJoiningProviderCallbacks(input: {
  db: Db;
  applicationId: string;
  secret: string;
  secureCookies: boolean;
}) {
  const { db, applicationId } = input;
  const readCurrent = createJoiningProviderIntent(input).fromHeaders;

  // eslint-disable-next-line complexity -- State, browser, provider, expiry and target must all match before the callback runs.
  function preflight(request: Request, providerId: string): CallbackContext | null {
    if (providerId !== "google" && providerId !== "github") return null;
    const state = new URL(request.url).searchParams.get("state");
    const stateHash = state ? hashJoiningValue("state", state) : null;
    const stored = stateHash
      ? (db
          .prepare(
            `SELECT * FROM company_join_intents
      WHERE providerStateHash = ?`,
          )
          .get(stateHash) as JoinIntent | undefined)
      : undefined;
    const current = readCurrent(request.headers);
    if (!stored && (!current || current.state !== "started" || current.providerStateHash === null)) return null;
    if (
      !stored ||
      !current ||
      stored.id !== current.id ||
      stored.providerId !== providerId ||
      current.state !== "started" ||
      current.expiresAt <= Date.now()
    ) {
      throw new JoiningProviderCallbackError();
    }
    const capture: CallbackContext = { intentId: current.id, stateHash: stateHash as string, providerId };
    assertCallbackIntent(db, capture);
    if (new URL(request.url).searchParams.has("error")) {
      db.prepare(
        `UPDATE company_join_intents SET state = 'cancelled', updatedAt = ?
        WHERE id = ? AND state = 'started'`,
      ).run(Date.now(), current.id);
      throw new JoiningProviderCallbackError("provider_cancelled");
    }
    return capture;
  }

  /** Called only from user.create.before while this exact provider callback is active. */
  function admitsNewIdentity(input: {
    email?: string;
    emailVerified?: boolean;
    providerId: string | null;
    facts: JoiningProviderFacts | null;
    hasAnyPrincipal: boolean;
  }): boolean {
    const capture = joiningProviderCallbackCapture.getStore();
    if (
      !capture ||
      !input.hasAnyPrincipal ||
      input.providerId !== capture.providerId ||
      input.emailVerified !== true ||
      !input.email
    )
      return false;
    try {
      const intent = assertCallbackIntent(db, capture);
      if (
        intent.principalId !== null ||
        !matchingFacts(intent, input.facts) ||
        normalizeAccountEmail(input.email) !== intent.email
      )
        return false;
      const restricted = db
        .prepare(
          `SELECT 1 FROM account_access_restrictions
        WHERE accountId = ? AND verifiedEmail = ? LIMIT 1`,
        )
        .get(intent.accountId, intent.email);
      return !restricted;
    } catch {
      return false;
    }
  }

  /** Better Auth has now persisted the provider subject and the v48 proof trigger atomically. */
  function bindSession(input: { principalId: string; facts: JoiningProviderFacts | null }): void {
    const capture = joiningProviderCallbackCapture.getStore();
    if (!capture) return;
    tx(
      db,
      () => {
        const intent = assertCallbackIntent(db, capture);
        if (
          !matchingFacts(intent, input.facts) ||
          (intent.principalId !== null && intent.principalId !== input.principalId)
        ) {
          throw new JoiningProviderCallbackError("company_join_identity_mismatch");
        }
        const linked = db
          .prepare(
            `SELECT 1 FROM account WHERE providerId = ? AND accountId = ? AND userId = ?
        LIMIT 1`,
          )
          .get(intent.providerId, input.facts.subject, input.principalId);
        const principal = db.prepare("SELECT email FROM user WHERE id = ?").get(input.principalId) as
          { email: string } | undefined;
        const proof = db
          .prepare(
            `SELECT 1 FROM identity_email_proofs
        WHERE principalId = ? AND email = ? AND source = ? LIMIT 1`,
          )
          .get(input.principalId, intent.email, intent.providerId);
        if (!linked || !principal || normalizeAccountEmail(principal.email) !== intent.email || !proof) {
          throw new JoiningProviderCallbackError("company_join_identity_mismatch");
        }
        const changed = db
          .prepare(
            `UPDATE company_join_intents SET state = 'approved', principalId = ?, updatedAt = ?
        WHERE id = ? AND state = 'started' AND providerStateHash = ? AND expiresAt > ?
          AND (principalId IS NULL OR principalId = ?)`,
          )
          .run(input.principalId, Date.now(), intent.id, capture.stateHash, Date.now(), input.principalId);
        if (changed.changes !== 1) throw new JoiningProviderCallbackError();
      },
      "immediate",
    );
  }

  function complete(input: {
    headers: Headers;
    actor: ActorContext;
    providerId: string | null;
    invitationToken?: string;
    requireMfa: boolean;
  }) {
    const intent = readCurrent(input.headers);
    if (
      !intent ||
      intent.state !== "approved" ||
      intent.expiresAt <= Date.now() ||
      (intent.providerId !== "google" && intent.providerId !== "github") ||
      input.providerId !== intent.providerId ||
      intent.principalId !== input.actor.principalId ||
      (input.requireMfa && !input.actor.mfaSatisfied)
    ) {
      throw createAccountFailure("AUTHENTICATION_REQUIRED", "Sign in with the verified provider to continue.");
    }
    return tx(
      db,
      () => {
        const current = readCurrent(input.headers);
        if (!current || current.id !== intent.id || current.state !== "approved" || current.expiresAt <= Date.now()) {
          throw createAccountFailure("INVITATION_EXPIRED", "Restart company joining.");
        }
        assertJoinIntentTargetLive(db, current);
        const invite = prepareCompanyAdmissionIntent({
          db,
          accountId: current.accountId,
          email: current.email,
          purpose: current.purpose,
          ...(input.invitationToken === undefined ? {} : { invitationToken: input.invitationToken }),
        });
        if ((invite?.id ?? null) !== current.invitationId)
          throw createAccountFailure("INVITATION_EXPIRED", "This invitation changed. Restart company joining.");
        const membership = admitCompanyInTx({
          db,
          applicationId,
          admissionId: current.id,
          confirmedSignIn: true,
          accountId: current.accountId,
          principalId: input.actor.principalId,
          email: current.email,
          purpose: current.purpose,
          ...(input.invitationToken === undefined ? {} : { invitationToken: input.invitationToken }),
        });
        completeJoinIntent({ db, intent: current, principalId: input.actor.principalId, now: Date.now() });
        return { accountId: current.accountId, role: membership.role };
      },
      "immediate",
    );
  }

  return { preflight, admitsNewIdentity, bindSession, complete };
}
