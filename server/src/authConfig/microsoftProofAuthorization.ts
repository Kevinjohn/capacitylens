import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { hasLiveProofInvitation, resolveProofInvitation } from "../accounts/proofInvitationPort";
import { assertJoinIntentTargetLive, prepareCompanyAdmissionIntent } from "../accounts/adminPort/joiningAdmission";
import { parseApprovedDomain } from "@capacitylens/shared/account/approvedDomains";
import { SESSION_FRESH_AGE_SECONDS } from "./authConstants";
import {
  MicrosoftProofError,
  type MicrosoftProofIntent,
  type MicrosoftProofPurpose,
  type MicrosoftProofSession,
} from "./microsoftProofPrimitives";

type Target = Pick<MicrosoftProofIntent, "targetEmail" | "inviteId" | "accountId" | "principalId" | "sessionId">;

function assertFreshLinkSession(
  db: Db,
  session: MicrosoftProofSession,
): asserts session is NonNullable<MicrosoftProofSession> & {
  session: NonNullable<NonNullable<MicrosoftProofSession>["session"]>;
} {
  if (
    !session?.session?.id ||
    !session.user.emailVerified ||
    Date.parse(session.session.createdAt) + SESSION_FRESH_AGE_SECONDS * 1000 <= Date.now() ||
    (session.session.expiresAt !== null && Date.parse(session.session.expiresAt) <= Date.now())
  ) {
    throw new MicrosoftProofError("MICROSOFT_LINK_SESSION_EXPIRED", 401);
  }
  const assurance = db
    .prepare("SELECT assurance FROM account_session_assurance WHERE sessionId = ? AND principalId = ?")
    .get(session.session.id, session.user.id) as { assurance: string } | undefined;
  if (
    !assurance ||
    (session.user.twoFactorEnabled && assurance.assurance !== "mfa" && assurance.assurance !== "federated")
  ) {
    throw new MicrosoftProofError("MICROSOFT_LINK_SESSION_EXPIRED", 401);
  }
}

// eslint-disable-next-line max-lines-per-function -- The factory groups two small checks over the same database and session dependency.
export function createMicrosoftProofAuthorization(input: {
  db: Db;
  bootstrapEmails: ReadonlySet<string>;
  getSession: (headers: Headers) => Promise<MicrosoftProofSession>;
}) {
  const { db, bootstrapEmails, getSession } = input;
  const countUsers = () => (db.prepare("SELECT COUNT(*) AS count FROM user").get() as { count: number }).count;

  function assertJoinTarget(input: { accountId: string; targetEmail: string; inviteId: string | null }): void {
    try {
      assertJoinIntentTargetLive(db, {
        accountId: input.accountId,
        email: input.targetEmail,
        purpose: input.inviteId ? "invitation" : "policy",
        invitationId: input.inviteId,
      });
      const principal = db.prepare("SELECT id FROM user WHERE lower(trim(email)) = ?").get(input.targetEmail) as
        { id: string } | undefined;
      if (
        db
          .prepare(
            `SELECT 1 FROM account_access_restrictions WHERE accountId = ?
        AND (principalId = ? OR verifiedEmail = ?) LIMIT 1`,
          )
          .get(input.accountId, principal?.id ?? "", input.targetEmail)
      )
        throw new MicrosoftProofError("MICROSOFT_JOIN_ACCESS_DISABLED", 403);
    } catch (error) {
      if (error instanceof MicrosoftProofError) throw error;
      throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403, { cause: error });
    }
  }

  async function assertLinkLive(intent: MicrosoftProofIntent, headers: Headers): Promise<void> {
    const session = await getSession(headers);
    assertFreshLinkSession(db, session);
    if (
      session.user.id !== intent.principalId ||
      session.session.id !== intent.sessionId ||
      normalizeAccountEmail(session.user.email) !== intent.targetEmail
    ) {
      throw new MicrosoftProofError("MICROSOFT_LINK_SESSION_EXPIRED", 401);
    }
  }

  async function assertLive(intent: MicrosoftProofIntent, headers: Headers): Promise<void> {
    if (intent.expiresAt <= Date.now() || intent.state === "cancelled" || intent.state === "completed") {
      throw new MicrosoftProofError("MICROSOFT_PROOF_EXPIRED", 410);
    }
    if (intent.purpose === "bootstrap") {
      if (countUsers() !== 0 || !bootstrapEmails.has(intent.targetEmail)) {
        throw new MicrosoftProofError("MICROSOFT_BOOTSTRAP_UNAVAILABLE", 409);
      }
      return;
    }
    if (intent.purpose === "invite") {
      if (!hasLiveProofInvitation(db, intent)) throw new MicrosoftProofError("MICROSOFT_INVITE_EXPIRED", 410);
      return;
    }
    if (intent.purpose === "join") {
      if (!intent.accountId) throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403);
      assertJoinTarget({ accountId: intent.accountId, targetEmail: intent.targetEmail, inviteId: intent.inviteId });
      return;
    }
    await assertLinkLive(intent, headers);
  }

  function resolveJoiningTarget(body: { email?: string; inviteToken?: string; accountId?: string }): Target {
    const targetEmail = normalizeAccountEmail(body.email ?? "");
    if (
      !body.accountId ||
      !isAccountEmail(targetEmail) ||
      parseApprovedDomain(targetEmail.slice(targetEmail.lastIndexOf("@") + 1)) === null
    ) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_ADDRESS_INVALID", 400);
    }
    let inviteId: string | null;
    try {
      const invite = prepareCompanyAdmissionIntent({
        db,
        accountId: body.accountId,
        email: targetEmail,
        purpose: body.inviteToken ? "invitation" : "policy",
        ...(body.inviteToken ? { invitationToken: body.inviteToken } : {}),
      });
      inviteId = invite?.id ?? null;
    } catch (error) {
      throw new MicrosoftProofError("MICROSOFT_JOIN_UNAVAILABLE", 403, { cause: error });
    }
    assertJoinTarget({ accountId: body.accountId, targetEmail, inviteId });
    return { targetEmail, inviteId, accountId: body.accountId, principalId: null, sessionId: null };
  }

  async function resolveTarget(
    body: { purpose: MicrosoftProofPurpose; email?: string; inviteToken?: string; accountId?: string },
    headers: Headers,
  ): Promise<Target> {
    let target: Target;
    if (body.purpose === "bootstrap") {
      const targetEmail = normalizeAccountEmail(body.email ?? "");
      if (!bootstrapEmails.has(targetEmail) || countUsers() !== 0)
        throw new MicrosoftProofError("MICROSOFT_BOOTSTRAP_UNAVAILABLE", 403);
      target = { targetEmail, inviteId: null, accountId: null, principalId: null, sessionId: null };
    } else if (body.purpose === "invite") {
      const invite = body.inviteToken ? resolveProofInvitation(db, body.inviteToken) : null;
      if (!invite) throw new MicrosoftProofError("MICROSOFT_INVITE_EXPIRED", 403);
      target = {
        targetEmail: normalizeAccountEmail(invite.preauthEmail),
        inviteId: invite.id,
        accountId: invite.accountId,
        principalId: null,
        sessionId: null,
      };
    } else if (body.purpose === "join") {
      target = resolveJoiningTarget(body);
    } else {
      const session = await getSession(headers);
      assertFreshLinkSession(db, session);
      target = {
        targetEmail: normalizeAccountEmail(session.user.email),
        inviteId: null,
        accountId: null,
        principalId: session.user.id,
        sessionId: session.session.id,
      };
    }
    if (!isAccountEmail(target.targetEmail)) throw new MicrosoftProofError("MICROSOFT_PROOF_ADDRESS_INVALID", 400);
    return target;
  }

  return { assertLive, resolveTarget };
}
