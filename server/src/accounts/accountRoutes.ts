import type { FastifyInstance } from "fastify";
import {
  MEMBER_SIGN_IN_TRACKING_RATE_LIMIT,
  type AccountRoute,
  type InvitationRoute,
  type InvitationTokenRoute,
  type MemberRoute,
  type OwnershipTransferRequestRoute,
  type SessionRoute,
  type AccountRouteDependencies,
} from "./routes/accountRouteDependencies";
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
  enableMemberAccess,
  listMembers,
  removeMember,
  setMemberSignInTracking,
  listResourceAvatars,
} from "./routes/handlers/memberAdmin";
import {
  clearMemberResourceLink,
  dismissMemberResourceLinkException,
  setMemberResourceLink,
} from "./routes/handlers/memberResourceLink";
import {
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  completeOwnershipTransfer,
  declineOwnershipTransfer,
  initiateOwnershipTransfer,
  readOwnershipTransfer,
  withdrawOwnershipTransfer,
} from "./routes/handlers/ownershipTransfer";
import { reconcile } from "./routes/handlers/reconcile";
import { listSessions, revokeSession, signOut } from "./routes/handlers/session";
import { createReplyHelpers } from "./routes/createReplyHelpers";
import { readJoiningPolicy, setJoiningPolicy } from "./routes/handlers/joiningPolicy";
export type { AccountRouteDependencies } from "./routes/accountRouteDependencies";

/**
 * Register the account-administration HTTP adapter.
 *
 * This module owns transport validation and response compatibility only. Policy stays in the
 * account-administration port/policy module; cross-port ordering stays in AccountFlows.
 */
// eslint-disable-next-line max-lines-per-function
export function registerAccountRoutes(app: FastifyInstance, dependencies: AccountRouteDependencies): void {
  const context = { ...dependencies, ...createReplyHelpers(dependencies) };

  // A command id plus its independent idempotency key is a high-entropy reconciliation bearer.
  // The response contains status and redacted repair coordinates only; never tenant or identity data.
  app.post("/api/account-commands/reconcile", async (req, reply) => reconcile(req, reply, context));

  app.post("/api/account/sign-out", async (req, reply) => signOut(req, reply, context));

  app.get("/api/account/sessions", async (req, reply) => listSessions(req, reply, context));

  app.delete<SessionRoute>("/api/account/sessions/:sessionId", async (req, reply) =>
    revokeSession(req, reply, context),
  );

  // Invite create: mint a single-use, expiring link that pre-sets a role for `accountId`.
  // Body: { accountId, role, expiresAt? }. Gated 'manageInvites' (admin+ of that account) via the
  // same authorize seam every permissioned route uses. Off mode is the allow-all no-op (the token
  // is minted as DEMO_USER's act), auth-on requires admin-tier membership of `accountId` (a
  // cross-tenant stranger → 403). The token is a 32-byte CSPRNG value, base64url-encoded; it is the
  // only secret here, so it is never logged (it's returned in the body to the authorised caller and
  // nowhere else).
  //
  // An optional `preauthEmail` may be attached: a non-empty, email-shaped value is stored
  // normalized (trim+lowercase) and turns this into a pre-authorised invite that the accept route
  // binds only for a caller whose verified email matches it (see preauthInviteAllows). Absent/empty
  // ⇒ stored as null ⇒ a link invite in trusted-local mode. Addressed invitations are
  // emailed when SMTP is configured; the copy-link flow remains available.
  app.post("/api/invites", async (req, reply) => createInvitation(req, reply, context));
  app.get<AccountRoute>("/api/accounts/:accountId/joining-policy", async (req, reply) =>
    readJoiningPolicy(req, reply, context),
  );
  app.put<AccountRoute>("/api/accounts/:accountId/joining-policy", async (req, reply) =>
    setJoiningPolicy(req, reply, context),
  );

  // Invite preview: public because a new invitee has no session yet, but still bearer-authorized;
  // only someone holding the unguessable token can read this deliberately small display shape.
  // No membership/user table is touched. A bound invite exposes only its local part plus `@…`;
  // the full address and domain never leave the account adapter.
  app.get<InvitationTokenRoute>("/api/invites/:token/preview", async (req, reply) =>
    previewInvitation(req, reply, context),
  );

  // Invite accept: a signed-in caller redeems a link, binding the invited role to their
  // membership. No authorize() call. The membership is the output of this route, not a precondition
  // (requireUser upstream already proved a real session, or attached DEMO_USER in off mode). The
  // token-state checks are the gate: unknown → 404, already-used → 409, expired → 410. An
  // email-preauth gate follows those and precedes the bind: a non-null preauthEmail must match the
  // caller's email; SSO also requires the IdP's verified-email assertion, while password mode uses
  // possession of the addressed invite as verification. A null preauthEmail is the link path
  // (any signed-in caller). On success the membership upsert and
  // the single-use stamp commit in one transaction (atomic bind), and markInviteUsed's
  // `usedAt IS NULL` clause double-guards single-use against a concurrent race.
  app.post<InvitationTokenRoute>("/api/invites/:token/accept", async (req, reply) =>
    acceptInvitation(req, reply, context),
  );

  // Password-only invite onboarding. The bearer token narrowly authorizes creating one identity;
  // the membership bind and token consumption then commit atomically before the route succeeds.
  // The client signs in afterwards and goes straight to the app because the invite is already used.
  app.post<InvitationTokenRoute>("/api/invites/:token/signup", async (req, reply) =>
    signupInvitation(req, reply, context),
  );

  // List members. Joins the membership rows with Better Auth user identity (name/email, read only
  // here, only for this authorized admin). isSelf marks the caller's own row (the client derives its
  // role from it). A missing name/email degrades to null, never a throw.
  app.get<AccountRoute>("/api/accounts/:accountId/members", async (req, reply) => listMembers(req, reply, context));
  app.get<AccountRoute>("/api/accounts/:accountId/resource-avatars", async (req, reply) =>
    listResourceAvatars(req, reply, context),
  );
  app.put<MemberRoute>("/api/accounts/:accountId/members/:userId/resource-link", async (req, reply) =>
    setMemberResourceLink(req, reply, context),
  );
  app.delete<MemberRoute>("/api/accounts/:accountId/members/:userId/resource-link", async (req, reply) =>
    clearMemberResourceLink(req, reply, context),
  );
  app.delete<MemberRoute>("/api/accounts/:accountId/members/:userId/resource-link-exception", async (req, reply) =>
    dismissMemberResourceLinkException(req, reply, context),
  );

  // Owner-only privacy control. The desired-state PUT is safely repeatable after a lost response:
  // enabling an already-enabled account never resets its confirmations, and disabling is a no-op
  // once the stored observations have been erased.
  app.put<AccountRoute>(
    "/api/accounts/:accountId/member-sign-in-tracking",
    { config: { rateLimit: MEMBER_SIGN_IN_TRACKING_RATE_LIMIT } },
    async (req, reply) => setMemberSignInTracking(req, reply, context),
  );

  // Change a non-owner member's ordinary role. Owner is rejected at shape/policy level for every
  // actor; the only ownership mutation is the explicit atomic transfer route below.
  app.patch<MemberRoute>("/api/accounts/:accountId/members/:userId", async (req, reply) =>
    changeMemberRole(req, reply, context),
  );

  // Change a member's lifecycle status: disable, archive, or restore to active. The role and join
  // date are untouched; only the authority to enter the account changes, because every
  // authorization read narrows on status = 'active'. Owner targets and the caller's own membership
  // are refused by the pure guard (canChangeMemberStatus); an administrator must not be able to
  // strand the account without an Owner, nor lock themselves out of the account they administer.
  app.patch<MemberRoute>("/api/accounts/:accountId/members/:userId/status", async (req, reply) =>
    changeMemberStatus(req, reply, context),
  );
  app.post<MemberRoute>("/api/accounts/:accountId/members/:userId/enable-access", async (req, reply) =>
    enableMemberAccess(req, reply, context),
  );

  // Revoke a member. 404 non-member; 403 by the pure guard (the Owner is never removable here).
  // 204 on success.
  app.delete<MemberRoute>("/api/accounts/:accountId/members/:userId", async (req, reply) =>
    removeMember(req, reply, context),
  );

  // Ownership transfer: the three-step consent ceremony that replaced the one-click
  // hand-over. The Owner nominates, the nominated Admin consents, the same Owner gives final
  // approval, so ownership never moves on one person's say-so, and the nominee is never made
  // responsible for a company without agreeing to it.
  //
  // Seven explicit routes, not a generic state patch: each step has a different authorised caller.
  // All seven gate on 'actOnOwnershipTransfer' at admin tier, deliberately: the nominee acts at
  // Admin tier, and a demoted former Owner must still be able to replay their own command. Owner
  // authority and participant identity are asserted by the port inside its transaction, where the
  // membership facts are still true. Every command carries `expectedRevision`, so a command formed
  // against an earlier acceptance cycle cannot apply to a later one.
  app.get<AccountRoute>("/api/accounts/:accountId/ownership-transfer", async (req, reply) =>
    readOwnershipTransfer(req, reply, context),
  );

  // Nominate, or replace an existing nomination atomically by naming it. Body
  // { toUserId, expectedRequestId?, expectedRevision? }.
  app.post<AccountRoute>("/api/accounts/:accountId/ownership-transfer", async (req, reply) =>
    initiateOwnershipTransfer(req, reply, context),
  );

  // The nominee's own consent, and its withdrawal. Nobody else may perform these, at any tier:
  // consent another Admin can give on the nominee's behalf is not consent.
  app.post<OwnershipTransferRequestRoute>(
    "/api/accounts/:accountId/ownership-transfer/:requestId/accept",
    async (req, reply) => acceptOwnershipTransfer(req, reply, context),
  );

  app.post<OwnershipTransferRequestRoute>(
    "/api/accounts/:accountId/ownership-transfer/:requestId/withdraw",
    async (req, reply) => withdrawOwnershipTransfer(req, reply, context),
  );

  app.post<OwnershipTransferRequestRoute>(
    "/api/accounts/:accountId/ownership-transfer/:requestId/decline",
    async (req, reply) => declineOwnershipTransfer(req, reply, context),
  );

  // Final approval by the same Owner who nominated. Demote-then-promote commit in one transaction
  // with the workflow row, so no request ever observes an ownerless company.
  app.post<OwnershipTransferRequestRoute>(
    "/api/accounts/:accountId/ownership-transfer/:requestId/complete",
    async (req, reply) => completeOwnershipTransfer(req, reply, context),
  );

  // The nominating Owner withdrawing the whole nomination.
  app.delete<OwnershipTransferRequestRoute>(
    "/api/accounts/:accountId/ownership-transfer/:requestId",
    async (req, reply) => cancelOwnershipTransfer(req, reply, context),
  );

  // Reset password: mint a single-use, 24h reset link token for a member. The app supports
  // optional self-service email, but this admin operation hands the link over out-of-band,
  // exactly like an invite. Gated 'manageMembers' + the account policy's identity-administration guard (an
  // admin must never reset an owner; a reset link is an account-takeover capability, so this is
  // the same escalation door the no-admin→owner-grant rule closes). Password mode only: 'sso'
  // delegates credentials to the IdP (400, not a crash), and off has no credentials at all. The
  // token rides Better Auth's own verification store (single-use, expiring) and is write-once:
  // returned exactly here, never listed or read back (the same posture as the invite token).
  app.post<MemberRoute>("/api/accounts/:accountId/members/:userId/reset-password", async (req, reply) =>
    resetPassword(req, reply, context),
  );

  // Revoke every active session for a member. Session state is identity-global, so the actor must
  // have reset-equivalent authority in every account the target belongs to; an admin of account X
  // cannot disrupt an owner of account Y merely because the identity is also present in X.
  app.post<MemberRoute>("/api/accounts/:accountId/members/:userId/revoke-sessions", async (req, reply) =>
    revokeMemberSessions(req, reply, context),
  );

  // List outstanding invites. No token in the response (it's a write-once bearer secret; see
  // listInvitesForAccount). Gated 'manageInvites'. Off → empty.
  app.get<AccountRoute>("/api/accounts/:accountId/invites", async (req, reply) => listInvitations(req, reply, context));

  // Revoke an invite by its non-secret id. Idempotent + scoped by accountId (cross-tenant guard);
  // 204 regardless of whether a row existed (don't leak existence). Gated 'manageInvites'.
  app.delete<InvitationRoute>("/api/accounts/:accountId/invites/:id", async (req, reply) =>
    revokeInvitation(req, reply, context),
  );
}
