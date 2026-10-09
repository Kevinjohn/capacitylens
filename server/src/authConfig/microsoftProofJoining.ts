import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { ActorContext } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { tx } from "../txn";
import {
  admitCompanyInTx,
  assertJoinIntentTargetLive,
  hasProofOwnerRestrictionConflict,
  prepareCompanyAdmissionIntent,
} from "../accounts/adminPort/joiningAdmission";
import { microsoftCallbackCapture } from "./captureContexts";
import { MicrosoftProofError } from "./microsoftProofPrimitives";
import type { MicrosoftProofIntent } from "./microsoftProofPrimitives";

type Intent = MicrosoftProofIntent;

/** Keep callback-bound join admission and session binding in one proof boundary. */
// eslint-disable-next-line max-lines-per-function -- These transitions share one exact browser-bound join intent.
export function createMicrosoftProofJoining(input: {
  db: Db;
  fromHeaders: (headers: Headers) => Intent | null;
  applicationId: string;
}) {
  const { db, fromHeaders, applicationId } = input;
  function hasJoiningCandidate(candidate: {
    email?: string;
    emailVerified?: boolean;
    providerId: string | null;
  }): boolean {
    return candidate.providerId === "microsoft" && candidate.emailVerified === true && Boolean(candidate.email);
  }

  function matchesJoiningCallback(
    intent: Intent,
    proofId: string,
    candidateEmail: string,
  ): intent is Intent & { accountId: string; oid: string } {
    return (
      intent.id === proofId &&
      intent.purpose === "join" &&
      intent.state === "approved" &&
      intent.expiresAt > Date.now() &&
      normalizeAccountEmail(candidateEmail) === intent.targetEmail &&
      Boolean(intent.accountId && intent.oid)
    );
  }

  /** A new principal is allowed only from this exact approved, same-browser Microsoft callback. */
  function admitsNewJoiningIdentity(candidate: {
    email?: string;
    emailVerified?: boolean;
    providerId: string | null;
  }): boolean {
    const capture = microsoftCallbackCapture.getStore();
    if (!capture?.proofId || !hasJoiningCandidate(candidate)) return false;
    if ((db.prepare("SELECT COUNT(*) AS count FROM user").get() as { count: number }).count === 0) return false;
    const intent = fromHeaders(capture.request.headers);
    if (!intent || !matchesJoiningCallback(intent, capture.proofId, candidate.email as string)) return false;
    try {
      // assertLive is asynchronous because linking also accepts a session; joining is synchronous.
      const principal = db.prepare("SELECT id FROM user WHERE lower(trim(email)) = ?").get(intent.targetEmail) as
        { id: string } | undefined;
      if (
        principal ||
        db
          .prepare(
            `SELECT 1 FROM account_access_restrictions WHERE accountId = ?
        AND verifiedEmail = ?`,
          )
          .get(intent.accountId, intent.targetEmail)
      )
        return false;
      assertJoinIntentTargetLive(db, {
        accountId: intent.accountId,
        email: intent.targetEmail,
        purpose: intent.inviteId ? "invitation" : "policy",
        invitationId: intent.inviteId,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Session creation is the proof boundary for a returning stable oid. */
  function bindJoiningSession(principalId: string): void {
    const capture = microsoftCallbackCapture.getStore();
    if (!capture?.proofId) return;
    const intent = fromHeaders(capture.request.headers);
    if (intent?.purpose !== "join") return;
    if (
      intent.id !== capture.proofId ||
      !intent.oid ||
      intent.expiresAt <= Date.now() ||
      (intent.state !== "approved" && intent.state !== "completed")
    ) {
      throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403);
    }
    tx(
      db,
      () => {
        const linked = db
          .prepare(
            `SELECT 1 FROM account JOIN user ON user.id = account.userId
        WHERE account.providerId = 'microsoft' AND account.accountId = ? AND account.userId = ?
          AND lower(user.email) = ?`,
          )
          .get(intent.oid, principalId, intent.targetEmail);
        if (!linked) throw new MicrosoftProofError("MICROSOFT_IDENTITY_MISMATCH", 403);
        const durable = db
          .prepare(
            `SELECT 1 FROM identity_email_proofs WHERE principalId = ? AND email = ?
        AND source = 'microsoft'`,
          )
          .get(principalId, intent.targetEmail);
        if (!durable) {
          if (intent.state !== "approved" || !intent.tokenHash || intent.sentCount < 1) {
            throw new MicrosoftProofError("MICROSOFT_PROOF_REQUIRED", 403);
          }
          if (hasProofOwnerRestrictionConflict(db, principalId, intent.targetEmail))
            throw new MicrosoftProofError("MICROSOFT_JOIN_ACCESS_DISABLED", 403);
          db.prepare(
            `INSERT INTO identity_email_proofs (principalId, email, source, provenAt)
          VALUES (?, ?, 'microsoft', ?) ON CONFLICT(principalId) DO UPDATE SET
          email = excluded.email, source = excluded.source, provenAt = excluded.provenAt`,
          ).run(principalId, intent.targetEmail, new Date().toISOString());
        }
        db.prepare(
          `UPDATE microsoft_identity_proofs SET state = 'completed', tokenHash = NULL, updatedAt = ?
        WHERE id = ? AND state IN ('approved', 'completed')`,
        ).run(Date.now(), intent.id);
      },
      "immediate",
    );
  }

  function assertJoiningCompletion(input: {
    headers: Headers;
    actor: ActorContext;
    providerId: string | null;
    requireMfa: boolean;
  }): Intent & { accountId: string; oid: string } {
    const intent = fromHeaders(input.headers);
    if (
      !intent ||
      intent.purpose !== "join" ||
      intent.state !== "completed" ||
      !intent.accountId ||
      !intent.oid ||
      intent.expiresAt <= Date.now() ||
      input.providerId !== "microsoft" ||
      (input.requireMfa && !input.actor.mfaSatisfied)
    ) {
      throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403);
    }
    return intent as Intent & { accountId: string; oid: string };
  }

  function completeJoining(input: {
    headers: Headers;
    actor: ActorContext;
    providerId: string | null;
    invitationToken?: string;
    requireMfa: boolean;
  }) {
    const intent = assertJoiningCompletion(input);
    return tx(
      db,
      () => {
        const linked = db
          .prepare(
            `SELECT 1 FROM account JOIN user ON user.id = account.userId
        JOIN identity_email_proofs AS proof ON proof.principalId = user.id
        WHERE account.providerId = 'microsoft' AND account.accountId = ? AND account.userId = ?
          AND lower(user.email) = ? AND proof.email = ? AND proof.source = 'microsoft'`,
          )
          .get(intent.oid, input.actor.principalId, intent.targetEmail, intent.targetEmail);
        if (!linked) throw new MicrosoftProofError("MICROSOFT_IDENTITY_MISMATCH", 403);
        const purpose = intent.inviteId ? "invitation" : "policy";
        if (purpose === "invitation" && !input.invitationToken)
          throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403);
        const invite = prepareCompanyAdmissionIntent({
          db,
          accountId: intent.accountId,
          email: intent.targetEmail,
          purpose,
          ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}),
        });
        if ((invite?.id ?? null) !== intent.inviteId) throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403);
        const membership = admitCompanyInTx({
          db,
          applicationId,
          admissionId: intent.id,
          confirmedSignIn: true,
          accountId: intent.accountId,
          principalId: input.actor.principalId,
          email: intent.targetEmail,
          purpose,
          ...(input.invitationToken ? { invitationToken: input.invitationToken } : {}),
        });
        const consumed = db
          .prepare(
            `UPDATE microsoft_identity_proofs SET state = 'cancelled', updatedAt = ?
        WHERE id = ? AND state = 'completed' AND expiresAt > ?`,
          )
          .run(Date.now(), intent.id, Date.now());
        if (consumed.changes !== 1) throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403);
        return { accountId: intent.accountId, role: membership.role };
      },
      "immediate",
    );
  }

  return { admitsNewJoiningIdentity, bindJoiningSession, completeJoining };
}
