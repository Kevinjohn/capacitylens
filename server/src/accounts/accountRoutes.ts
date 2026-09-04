import type { FastifyInstance } from "fastify";
import { MEMBER_SIGN_IN_TRACKING_RATE_LIMIT, type AccountRouteDependencies } from "./routes/accountRouteDependencies";
import { resetPassword, revokeMemberSessions } from "./routes/handlers/credentialAdmin";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
  signupInvitation,
} from "./routes/handlers/invitation";
import {
  changeMemberRole,
  changeMemberStatus,
  listMembers,
  removeMember,
  setMemberSignInTracking,
  transferOwnership,
} from "./routes/handlers/memberAdmin";
import { reconcile } from "./routes/handlers/reconcile";
import { listSessions, revokeSession, signOut } from "./routes/handlers/session";
import { replyHelpers } from "./routes/replyHelpers";
export type { AccountRouteDependencies } from "./routes/accountRouteDependencies";

/**
 * Register the account-administration HTTP adapter.
 *
 * This module owns transport validation and response compatibility only. Policy stays in the
 * account-administration port/policy module; cross-port ordering stays in AccountFlows.
 */
export function registerAccountRoutes(app: FastifyInstance, dependencies: AccountRouteDependencies): void {
  const context = { ...dependencies, ...replyHelpers(dependencies) };

  // A command id plus its independent idempotency key is a high-entropy reconciliation bearer.
  // The response contains status and redacted repair coordinates only; never tenant or identity data.
  app.post("/api/account-commands/reconcile", async (req, reply) => reconcile(req, reply, context));

  app.post("/api/account/sign-out", async (req, reply) => signOut(req, reply, context));

  app.get("/api/account/sessions", async (req, reply) => listSessions(req, reply, context));

  app.delete("/api/account/sessions/:sessionId", async (req, reply) => revokeSession(req, reply, context));

  // Invite CREATE (P1.9): mint a single-use, expiring link that pre-sets a role for `accountId`.
  // Body: { accountId, role, expiresAt? }. GATED 'manageInvites' (admin+ of THAT account) via the
  // same authorize seam every permissioned route uses — OFF mode is the allow-all no-op (the token
  // is minted as DEMO_USER's act), auth-on requires admin-tier membership of `accountId` (a
  // cross-tenant stranger → 403). The token is a 32-byte CSPRNG value, base64url-encoded; it is the
  // ONLY secret here, so it is NEVER logged (it's returned in the body to the authorised caller and
  // nowhere else).
  //
  // P1.10 — an optional `preauthEmail` may be attached: a non-empty, email-shaped value is stored
  // NORMALIZED (trim+lowercase) and turns this into a pre-authorised invite that the accept route
  // binds ONLY for a caller whose VERIFIED email matches it (see preauthInviteAllows). Absent/empty
  // ⇒ stored as null ⇒ a P1.9 link invite (any signed-in caller may accept). Nothing is ever
  // emailed — the admin still hands out the link; preauthEmail only narrows who may redeem it.
  app.post("/api/invites", async (req, reply) => createInvitation(req, reply, context));

  // Invite PREVIEW: public because a new invitee has no session yet, but still bearer-authorized —
  // only someone holding the unguessable token can read this deliberately small display shape.
  // No membership/user table is touched, and no account data beyond the company name leaves.
  app.get("/api/invites/:token/preview", async (req, reply) => previewInvitation(req, reply, context));

  // Invite ACCEPT (P1.9): a signed-in caller redeems a link, binding the invited role to THEIR
  // membership. NO authorize() call — the membership is the OUTPUT of this route, not a precondition
  // (requireUser upstream already proved a real session, or attached DEMO_USER in OFF mode). The
  // token-state checks ARE the gate: unknown → 404, already-used → 409, expired → 410. P1.10 adds an
  // email-preauth gate AFTER those and BEFORE the bind: a non-null preauthEmail must match the
  // caller's email; SSO also requires the IdP's verified-email assertion, while password mode uses
  // possession of the addressed invite as verification. A null preauthEmail is the P1.9 link path
  // (any signed-in caller). On success the membership upsert and
  // the single-use stamp commit in ONE transaction (atomic bind), and markInviteUsed's
  // `usedAt IS NULL` clause double-guards single-use against a concurrent race.
  app.post("/api/invites/:token/accept", async (req, reply) => acceptInvitation(req, reply, context));

  // Password-only invite onboarding. The bearer token narrowly authorizes creating one identity;
  // the membership bind and token consumption then commit atomically before the route succeeds.
  // The client signs in afterwards and goes straight to the app because the invite is already used.
  app.post("/api/invites/:token/signup", async (req, reply) => signupInvitation(req, reply, context));

  // LIST members. Joins the membership rows with Better Auth user identity (name/email, read ONLY
  // here, only for this authorized admin). isSelf marks the caller's own row (the client derives its
  // role from it). A missing name/email degrades to null — never a throw.
  app.get("/api/accounts/:accountId/members", async (req, reply) => listMembers(req, reply, context));

  // OWNER-only privacy control. The desired-state PUT is safely repeatable after a lost response:
  // enabling an already-enabled account never resets its confirmations, and disabling is a no-op
  // once the stored observations have been erased.
  app.put(
    "/api/accounts/:accountId/member-sign-in-tracking",
    { config: { rateLimit: MEMBER_SIGN_IN_TRACKING_RATE_LIMIT } },
    async (req, reply) => setMemberSignInTracking(req, reply, context),
  );

  // CHANGE a non-owner member's ordinary role. Owner is rejected at shape/policy level for every
  // actor; the only ownership mutation is the explicit atomic transfer route below.
  app.patch("/api/accounts/:accountId/members/:userId", async (req, reply) => changeMemberRole(req, reply, context));

  // CHANGE a member's lifecycle status: disable, archive, or restore to active. The role and join
  // date are untouched — only the authority to enter the account changes, because every
  // authorization read narrows on status = 'active'. Owner targets and the caller's own membership
  // are refused by the pure guard (canChangeMemberStatus); an administrator must not be able to
  // strand the account without an Owner, nor lock themselves out of the account they administer.
  app.patch("/api/accounts/:accountId/members/:userId/status", async (req, reply) =>
    changeMemberStatus(req, reply, context),
  );

  // REVOKE a member. 404 non-member; 403 by the pure guard (the Owner is never removable here).
  // 204 on success.
  app.delete("/api/accounts/:accountId/members/:userId", async (req, reply) => removeMember(req, reply, context));

  // TRANSFER ownership (P1.11): hand the account to another EXISTING member and step the caller down
  // to admin, atomically. Gated 'transferOwnership' — the ONE action above admin in the matrix, so a
  // mere admin is 403 (authorize resolves the caller's role for this account). Body { toUserId }. The
  // target must already be an active member (404 else) and not the caller (400 — you're already owner).
  // Demote-caller and promote-target commit in ONE tx, so no other request observes an ownerless
  // account and the v10 unique index never permits co-owners. OFF mode has no owner model and
  // reports that member management is unavailable.
  app.post("/api/accounts/:accountId/transfer-ownership", async (req, reply) => transferOwnership(req, reply, context));

  // RESET PASSWORD (P1.18): mint a single-use, 24h reset LINK token for a member — the app has
  // no email infrastructure (a standing non-goal), so the admin hands the link over out-of-band,
  // exactly like an invite. Gated 'manageMembers' + the account policy's identity-administration guard (an
  // admin must never reset an OWNER — a reset link is an account-takeover capability, so this is
  // the same escalation door the no-admin→owner-grant rule closes). Password mode ONLY: 'sso'
  // delegates credentials to the IdP (400, not a crash), and OFF has no credentials at all. The
  // token rides Better Auth's own verification store (single-use, expiring) and is WRITE-ONCE:
  // returned exactly here, never listed or read back — same posture as the invite token.
  app.post("/api/accounts/:accountId/members/:userId/reset-password", async (req, reply) =>
    resetPassword(req, reply, context),
  );

  // Revoke every active session for a member. Session state is identity-global, so the actor must
  // have reset-equivalent authority in every account the target belongs to; an admin of account X
  // cannot disrupt an owner of account Y merely because the identity is also present in X.
  app.post("/api/accounts/:accountId/members/:userId/revoke-sessions", async (req, reply) =>
    revokeMemberSessions(req, reply, context),
  );

  // LIST outstanding invites — NO token in the response (it's a write-once bearer secret; see
  // listInvitesForAccount). Gated 'manageInvites'. OFF → empty.
  app.get("/api/accounts/:accountId/invites", async (req, reply) => listInvitations(req, reply, context));

  // REVOKE an invite by its non-secret id. Idempotent + scoped by accountId (cross-tenant guard);
  // 204 regardless of whether a row existed (don't leak existence). Gated 'manageInvites'.
  app.delete("/api/accounts/:accountId/invites/:id", async (req, reply) => revokeInvitation(req, reply, context));
}
