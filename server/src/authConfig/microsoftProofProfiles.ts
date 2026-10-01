import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { tx } from "../txn";
import { microsoftCallbackCapture } from "./captureContexts";
import type { createMicrosoftProofAuthorization } from "./microsoftProofAuthorization";
import { MicrosoftProofError, hasVerifiedMicrosoftEmail } from "./microsoftProofPrimitives";
import type { MicrosoftProofIntent } from "./microsoftProofPrimitives";

type Intent = MicrosoftProofIntent;

/** Bind a native callback to its exact proof intent and stable Microsoft object id. */
// eslint-disable-next-line max-lines-per-function -- First and returning profiles share the callback proof boundary.
export function createMicrosoftProofProfiles(input: {
  db: Db;
  fromHeaders: (headers: Headers) => Intent | null;
  authorization: Pick<ReturnType<typeof createMicrosoftProofAuthorization>, "assertLive">;
  tenantId: string;
  sendToken: (intent: Intent) => Promise<void>;
  retireExpiredApprovals: (oid: string) => void;
}) {
  const { db, fromHeaders, authorization, tenantId, sendToken, retireExpiredApprovals } = input;
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
      tx(
        db,
        () => {
          retireExpiredApprovals(oid);
          db.prepare(
            "UPDATE microsoft_identity_proofs SET state = 'approved', updatedAt = ? WHERE id = ? AND state = 'started'",
          ).run(Date.now(), intent.id);
        },
        "immediate",
      );
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

  async function continueReturningJoin(input: {
    intent: Intent;
    existing: { principalId: string; email: string };
    oid: string;
    capture: NonNullable<ReturnType<typeof microsoftCallbackCapture.getStore>>;
  }): Promise<void> {
    const { intent, existing, oid, capture } = input;
    if (normalizeAccountEmail(existing.email) !== intent.targetEmail) {
      throw new MicrosoftProofError("MICROSOFT_IDENTITY_MISMATCH", 403);
    }
    if (intent.state === "approved") {
      capture.proofId = intent.id;
      return;
    }
    if (intent.state === "mail-sent") {
      capture.pending = true;
      throw new MicrosoftProofError("MICROSOFT_PROOF_PENDING", 403);
    }
    const durable = db
      .prepare(
        `SELECT 1 FROM identity_email_proofs WHERE principalId = ? AND email = ?
          AND source = 'microsoft'`,
      )
      .get(existing.principalId, intent.targetEmail);
    if (durable) {
      tx(
        db,
        () => {
          retireExpiredApprovals(oid);
          db.prepare(
            `UPDATE microsoft_identity_proofs SET oid = ?, state = 'approved', updatedAt = ?
              WHERE id = ? AND state = 'started'`,
          ).run(oid, Date.now(), intent.id);
        },
        "immediate",
      );
      capture.proofId = intent.id;
      return;
    }
    db.prepare(
      `UPDATE microsoft_identity_proofs SET oid = ?, updatedAt = ?
          WHERE id = ? AND state = 'started' AND oid IS NULL`,
    ).run(oid, Date.now(), intent.id);
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
        `SELECT user.id AS principalId, user.email FROM account JOIN user ON user.id = account.userId
      WHERE account.providerId = 'microsoft' AND account.accountId = ? LIMIT 1`,
      )
      .get(oid) as { principalId: string; email: string } | undefined;
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
      if (intent.purpose === "join") {
        await continueReturningJoin({ intent, existing, oid, capture });
        return { email: existing.email, emailVerified: true };
      }
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

  return { onProfile };
}
