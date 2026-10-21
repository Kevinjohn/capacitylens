import type { FastifyInstance } from "fastify";
import { MEMBER_SIGN_IN_TRACKING_RATE_LIMIT } from "./routes/accountRouteDependencies";
import type {
  AccountRoute,
  InvitationRoute,
  InvitationTokenRoute,
  MemberRoute,
  OwnershipTransferRequestRoute,
  SessionRoute,
  AccountRouteDependencies,
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
import { changeMemberRole, changeMemberStatus, enableMemberAccess, removeMember } from "./routes/handlers/memberAdmin";
import { listMembers, setMemberSignInTracking, listResourceAvatars } from "./routes/handlers/memberDirectory";
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

  // The invitation bearer authorizes onboarding and must never enter logs. Addressed invitations
  // bind redemption to the normalized email; trusted-local mode also permits unaddressed links.
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

  // Invitation redemption grants membership, so existing membership cannot be a precondition.
  // The administration port validates the bearer and identity, then commits membership and token
  // consumption atomically.
  app.post<InvitationTokenRoute>("/api/invites/:token/accept", async (req, reply) =>
    acceptInvitation(req, reply, context),
  );

  // Password-only invite onboarding. The bearer token narrowly authorizes creating one identity;
  // the membership bind and token consumption then commit atomically before the route succeeds.
  // The client signs in afterwards and goes straight to the app because the invite is already used.
  app.post<InvitationTokenRoute>("/api/invites/:token/signup", async (req, reply) =>
    signupInvitation(req, reply, context),
  );

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

  app.delete<MemberRoute>("/api/accounts/:accountId/members/:userId", async (req, reply) =>
    removeMember(req, reply, context),
  );

  // Ownership moves only after the Owner nominates, the nominee consents, and the same Owner approves.
  // Each ownership-transfer step has a distinct participant policy enforced inside the port transaction.
  // Row commands require the expected revision so consent from an earlier cycle cannot authorize a later one.
  app.get<AccountRoute>("/api/accounts/:accountId/ownership-transfer", async (req, reply) =>
    readOwnershipTransfer(req, reply, context),
  );

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

  app.delete<OwnershipTransferRequestRoute>(
    "/api/accounts/:accountId/ownership-transfer/:requestId",
    async (req, reply) => cancelOwnershipTransfer(req, reply, context),
  );

  // A password-reset bearer can take over an identity. The flow therefore checks the actor’s
  // authority across every company the target can enter and requires fresh session assurance.
  // Reset issuance is available only when password sign-in is enabled.
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
